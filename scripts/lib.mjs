import { createHash } from 'node:crypto';
import { routesForEnvironment } from '../web/routes.mjs';
import { lowerIsBetter, metricStatus } from '../web/budgets.mjs';

export const metricKeys = ['performance', 'accessibility', 'bestPractices', 'seo', 'lcpMs', 'cls', 'tbtMs'];
export { lowerIsBetter, metricStatus };
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const median = values => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null;
};

export function validateConfig(config) {
  if (config.schemaVersion !== 1 || !Array.isArray(config.routes) || !config.routes.length) throw new Error('Invalid monitoring configuration');
  if (!Number.isInteger(config.retryCount) || config.retryCount < 0 || config.retryCount > 2) throw new Error('Invalid retry budget');
  if (!/^[\w-]+\/[\w.-]+$/.test(config.repository)) throw new Error('Invalid repository');
  for (const [id, environment] of Object.entries(config.environments)) {
    const url = new URL(environment.origin);
    if (!/^[a-z-]+$/.test(id) || url.protocol !== 'https:' || url.origin !== environment.origin || url.username || url.password) throw new Error('Expected a public HTTPS origin');
  }
  const ids = new Set();
  for (const route of config.routes) {
    if (!/^[a-z][a-z0-9-]*$/.test(route.id) || ids.has(route.id) || !route.path.startsWith('/') || route.path.startsWith('//')) throw new Error('Invalid or duplicate route');
    if (new URL(route.path, 'https://example.com').origin !== 'https://example.com') throw new Error('Cross-origin route');
    if (route.environments !== undefined && (!Array.isArray(route.environments) || !route.environments.length || new Set(route.environments).size !== route.environments.length || route.environments.some(environment => !Object.hasOwn(config.environments, environment)))) throw new Error('Invalid route environment scope');
    ids.add(route.id);
  }
  for (const key of metricKeys) {
    if (!Number.isFinite(config.targets[key]) || !Number.isFinite(config.critical[key])) throw new Error('Invalid performance budget');
    if (lowerIsBetter.has(key) ? config.critical[key] < config.targets[key] : config.critical[key] > config.targets[key]) throw new Error('Inverted budget');
  }
  return config;
}

export function selectPlan(config, { environment = 'production', routes = '', runs = config.runs } = {}) {
  validateConfig(config);
  if (!Object.hasOwn(config.environments, environment)) throw new Error('Unknown environment');
  runs = Number(runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('Runs must be an integer from 1 to 5');
  const ids = routes.split(',').map(s => s.trim()).filter(Boolean);
  const available = routesForEnvironment(config, environment);
  if (ids.some(id => !available.some(route => route.id === id))) throw new Error('Unknown or unavailable route in selected environment');
  return { environment, origin: config.environments[environment].origin, routes: available.filter(route => !ids.length || ids.includes(route.id)), runs };
}

export function routeStatus(route, config) {
  if (route.successCount !== route.expectedCount) return 'failed';
  const statuses = metricKeys.map(key => metricStatus(key, route.metrics[key], config));
  return ['failed', 'critical', 'warning'].find(status => statuses.includes(status)) ?? 'pass';
}

export function extractResult(lhr, expectedUrl) {
  if (lhr.runtimeError) throw new Error(`Lighthouse: ${lhr.runtimeError.code}`);
  if (lhr.audits['http-status-code']?.score === 0) throw new Error('Page returned an unsuccessful HTTP status');
  const finalUrl = new URL(lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl);
  const expected = new URL(expectedUrl);
  if (finalUrl.origin !== expected.origin || finalUrl.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) throw new Error('Unexpected redirect; target page was not measured');
  for (const [key, value] of expected.searchParams) if (finalUrl.searchParams.get(key) !== value) throw new Error('Route parameters changed');
  const score = id => typeof lhr.categories[id]?.score === 'number' ? Math.round(lhr.categories[id].score * 100) : null;
  const metrics = {
    performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'), seo: score('seo'),
    lcpMs: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
    cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? null,
    tbtMs: lhr.audits['total-blocking-time']?.numericValue ?? null,
    fcpMs: lhr.audits['first-contentful-paint']?.numericValue ?? null,
  };
  if (metricKeys.some(key => !Number.isFinite(metrics[key]))) throw new Error('Required Lighthouse metrics are missing');
  return { metrics, finalUrl: finalUrl.href };
}

export function summarizeRoute(route, samples, errors, expectedCount, config) {
  const metrics = Object.fromEntries([...metricKeys, 'fcpMs'].map(key => [key, median(samples.map(sample => sample.metrics[key]))]));
  const ranges = Object.fromEntries(metricKeys.map(key => {
    const values = samples.map(sample => sample.metrics[key]).filter(Number.isFinite);
    return [key, values.length ? { min: Math.min(...values), max: Math.max(...values) } : null];
  }));
  const representative = samples.toSorted((a, b) => Math.abs(a.metrics.performance - metrics.performance) - Math.abs(b.metrics.performance - metrics.performance))[0];
  const result = { ...route, metrics, ranges, successCount: samples.length, expectedCount, errors, representative: representative?.report ?? null, samples };
  return { ...result, status: routeStatus(result, config) };
}

export function regression(current, baseline) {
  if (!baseline || current.status === 'failed' || baseline.status === 'failed') return [];
  const changes = [];
  if (current.metrics.performance < baseline.metrics.performance - 5) changes.push('performance');
  if (current.metrics.lcpMs > baseline.metrics.lcpMs * 1.2 && current.metrics.lcpMs - baseline.metrics.lcpMs > 300) changes.push('lcpMs');
  return changes;
}

export function comparableBaseline(history, summary, routeId) {
  return history.filter(previous => previous.environment === summary.environment && previous.comparisonKey === summary.comparisonKey && previous.runsPerRoute === summary.runsPerRoute && previous.generatedAt < summary.generatedAt)
    .toSorted((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .map(previous => previous.routes.find(route => route.id === routeId && route.status !== 'failed')).find(Boolean) ?? null;
}

export async function runCollection({ config, plan, audit, saveReport, metadata, onProgress = () => {} }) {
  const routes = [];
  for (const route of plan.routes) {
    const url = new URL(route.path, plan.origin).href;
    const samples = [], errors = [];
    for (let index = 1; index <= plan.runs; index++) {
      for (let attempt = 1; attempt <= config.retryCount + 1; attempt++) {
        onProgress({ route: route.id, index, attempt });
        try {
          const result = await audit(url);
          if (!result?.lhr) throw new Error('Lighthouse did not return a report');
          const report = `${route.id}-run-${index}-attempt-${attempt}`;
          await saveReport(report, result);
          const extracted = extractResult(result.lhr, url);
          samples.push({ ...extracted, report });
          break;
        } catch (error) {
          errors.push({ run: index, attempt, message: error instanceof Error ? error.message : String(error), recovered: attempt <= config.retryCount });
        }
      }
    }
    // Preserve both failed attempts and eventual recovery; counts distinguish an incomplete batch.
    for (const error of errors) error.recovered = samples.some(sample => sample.report.startsWith(`${route.id}-run-${error.run}-`));
    routes.push(summarizeRoute(route, samples, errors, plan.runs, config));
  }
  return { schemaVersion: 1, ...metadata, environment: plan.environment, origin: plan.origin, profile: config.profile, runsPerRoute: plan.runs, targets: config.targets, critical: config.critical, routes };
}

export function pipelineHealthy(health, { event, collection, publish, deploy }) {
  return health.failed === 0 && (collection === 'success' || event === 'push' && collection === 'skipped') && publish === 'success' && deploy === 'success';
}
