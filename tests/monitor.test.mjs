import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';
import { saveHistory } from '../scripts/history-git.mjs';
import { median, selectPlan, validateConfig, metricStatus, summarizeRoute, extractResult, runCollection, regression, comparableBaseline, pipelineHealthy } from '../scripts/lib.mjs';
import { archive, mergeHistory, latestRoutes } from '../scripts/archive.mjs';
import { build } from '../scripts/build.mjs';
import { latestForRoute, seriesFor, artifactAvailable, dataPresentation, escapeHtml } from '../web/model.mjs';
import { messages } from '../web/i18n.mjs';
import { resolveSettings } from 'lighthouse/core/config/config-helpers.js';

const config = JSON.parse(await fs.readFile(new URL('../monitor.config.json', import.meta.url), 'utf8'));
const metrics = { performance: 92, accessibility: 100, bestPractices: 100, seo: 100, lcpMs: 1200, cls: 0, tbtMs: 0, fcpMs: 500 };
const route = (overrides = {}) => ({ ...config.routes[0], metrics: { ...metrics }, status: 'pass', successCount: 3, expectedCount: 3, representative: 'landing-run-1-attempt-1', errors: [], samples: [], ...overrides });
const summary = (overrides = {}) => ({ schemaVersion: 1, id: '100-1-production', environment: 'production', origin: config.environments.production.origin, generatedAt: '2026-11-11T01:17:00.000Z', comparisonKey: 'fixed-profile', runsPerRoute: 3, versions: { lighthouse: '13.4.1', chrome: '157' }, targets: config.targets, profile: config.profile, critical: config.critical, routes: [route()], ...overrides });
const lhr = (overrides = {}) => ({ requestedUrl: 'https://vidma.ai/zh/', finalDisplayedUrl: 'https://vidma.ai/zh/', categories: Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo'].map(key => [key, { score: 1 }])), audits: { 'http-status-code': { score: 1 }, 'largest-contentful-paint': { numericValue: 1200 }, 'cumulative-layout-shift': { numericValue: 0 }, 'total-blocking-time': { numericValue: 0 } }, ...overrides });

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lighthouse-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('configuration selects both public deployment targets and preserves route parameters', () => {
  assert.equal(selectPlan(config, { environment: 'staging' }).origin, 'https://vidmaeditor-ios.web.app');
  assert.equal(selectPlan(config, { routes: 'video-create,landing' }).routes[1].path, '/zh/video-create/?mode=text');
  assert.equal(selectPlan(config).routes.length, 8);
});
test('desktop settings override Lighthouse mobile UA defaults and reject incomplete profiles', () => {
  const { id, ...flags } = config.profile;
  const settings = resolveSettings({}, flags);
  assert.equal(settings.formFactor, 'desktop');
  assert.equal(settings.screenEmulation.mobile, false);
  assert.equal(settings.emulatedUserAgent, false);
  const legacy = structuredClone(config);
  delete legacy.profile.emulatedUserAgent;
  assert.match(resolveSettings({}, legacy.profile).emulatedUserAgent, /Mobile/);
  assert.throws(() => validateConfig(legacy), /desktop user agent/);
  const mismatched = structuredClone(config);
  mismatched.profile.screenEmulation.mobile = true;
  assert.throws(() => validateConfig(mismatched), /desktop viewport/);
});
test('invalid environments, routes and repeat counts are rejected before launch', () => {
  for (const options of [{ environment: 'other' }, { routes: 'landing,other' }, { runs: 0 }, { runs: 6 }, { runs: 1.5 }, { runs: 'abc' }]) assert.throws(() => selectPlan(config, options));
  assert.equal(selectPlan(config, { runs: '1' }).runs, 1);
  assert.equal(selectPlan(config, { runs: 5 }).runs, 5);
});
test('configuration prevents invalid targets, duplicate routes and inverted budgets', () => {
  const invalid = structuredClone(config); invalid.environments.production.origin = 'http://localhost'; assert.throws(() => validateConfig(invalid));
  const duplicate = structuredClone(config); duplicate.routes.push(duplicate.routes[0]); assert.throws(() => validateConfig(duplicate));
  const crossOrigin = structuredClone(config); crossOrigin.routes[0].path = '//example.com'; assert.throws(() => validateConfig(crossOrigin));
  const inverted = structuredClone(config); inverted.critical.lcpMs = 1; assert.throws(() => validateConfig(inverted));
});
test('medians handle empty, non-finite and even samples without inventing zero', () => {
  assert.equal(median([]), null); assert.equal(median([NaN, Infinity]), null); assert.equal(median([4, 1, 2]), 2); assert.equal(median([0, 3]), 1.5);
});
test('budget boundaries retain the existing warning and critical semantics', () => {
  assert.equal(metricStatus('performance', 90, config), 'pass'); assert.equal(metricStatus('performance', 70, config), 'warning'); assert.equal(metricStatus('performance', 69, config), 'critical');
  assert.equal(metricStatus('lcpMs', 2500, config), 'pass'); assert.equal(metricStatus('lcpMs', 4000, config), 'warning'); assert.equal(metricStatus('lcpMs', 4001, config), 'critical'); assert.equal(metricStatus('cls', null, config), 'failed');
});
test('summaries preserve medians, ranges and an actual representative report', () => {
  const result = summarizeRoute(config.routes[0], [80, 91, 99].map((score, index) => ({ metrics: { ...metrics, performance: score }, report: `sample-${index}` })), [], 3, config);
  assert.equal(result.metrics.performance, 91); assert.deepEqual(result.ranges.performance, { min: 80, max: 99 }); assert.equal(result.representative, 'sample-1'); assert.equal(result.status, 'pass');
});
test('partial and completely failed collections cannot pass or become zero scores', () => {
  const partial = summarizeRoute(config.routes[0], [{ metrics, report: 'sample' }], [], 3, config); assert.equal(partial.status, 'failed');
  const failed = summarizeRoute(config.routes[0], [], [], 3, config); assert.equal(failed.metrics.performance, null); assert.equal(failed.status, 'failed'); assert.equal(failed.representative, null);
});
test('successful Lighthouse extraction accepts valid zero-valued CLS and TBT', () => {
  const result = extractResult(lhr(), 'https://vidma.ai/zh/'); assert.equal(result.metrics.cls, 0); assert.equal(result.metrics.tbtMs, 0);
});
test('HTTP errors, runtime errors, login redirects and missing metrics are collection failures', () => {
  assert.throws(() => extractResult(lhr({ runtimeError: { code: 'NO_FCP' } }), 'https://vidma.ai/zh/'));
  assert.throws(() => extractResult(lhr({ audits: { 'http-status-code': { score: 0 } } }), 'https://vidma.ai/zh/'));
  assert.throws(() => extractResult(lhr({ finalDisplayedUrl: 'https://vidma.ai/login/' }), 'https://vidma.ai/zh/'));
  assert.throws(() => extractResult(lhr({ finalDisplayedUrl: 'https://example.com/zh/' }), 'https://vidma.ai/zh/'));
  assert.throws(() => extractResult(lhr({ categories: {} }), 'https://vidma.ai/zh/'));
  assert.throws(() => extractResult(lhr(), 'https://vidma.ai/zh/?mode=text'));
});
test('collector retries one failed attempt and preserves recovery evidence', async () => {
  let calls = 0; const saved = [];
  const result = await runCollection({ config, plan: selectPlan(config, { routes: 'landing', runs: 1 }), metadata: summary(), audit: async () => { if (++calls === 1) throw new Error('Temporary timeout'); return { lhr: lhr() }; }, saveReport: async name => saved.push(name) });
  assert.equal(calls, 2); assert.equal(result.routes[0].status, 'pass'); assert.equal(result.routes[0].errors[0].recovered, true); assert.equal(saved.length, 1);
});
test('collector records exhausted retries without preventing subsequent pages', async () => {
  const result = await runCollection({ config, plan: selectPlan(config, { routes: 'landing,home', runs: 1 }), metadata: summary(), audit: async url => { if (url.includes('/home/')) return { lhr: lhr({ finalDisplayedUrl: url }) }; throw new Error('Timeout'); }, saveReport: async () => {} });
  assert.equal(result.routes[0].status, 'failed'); assert.equal(result.routes[0].errors.length, 2); assert.equal(result.routes[1].status, 'pass');
});
test('history is immutable on rerun and ordered by actual measurement time', () => {
  const first = summary(), second = summary({ id: '101-1-production', generatedAt: '2026-11-11T13:17:00.000Z' });
  const result = mergeHistory([second], [first, { ...second, origin: 'changed' }]);
  assert.equal(result.length, 2); assert.equal(result[0].id, first.id); assert.equal(result[1].origin, second.origin);
  assert.throws(() => mergeHistory([], [summary({ id: '../../escape' })]));
});
test('regression detection excludes failed measurements and insignificant timing noise', () => {
  assert.deepEqual(regression(route({ metrics: { ...metrics, performance: 86, lcpMs: 1600 } }), route()), ['performance', 'lcpMs']);
  assert.deepEqual(regression(route({ metrics: { ...metrics, lcpMs: 1450 } }), route()), []);
  assert.deepEqual(regression(route({ status: 'failed' }), route()), []);
});
test('baselines never cross environment, sample count or tool/settings versions', () => {
  const first = summary();
  const current = summary({ id: '101-1-production', generatedAt: '2026-11-12T01:17:00.000Z' });
  assert.ok(comparableBaseline([first], current, 'landing'));
  for (const patch of [{ environment: 'staging' }, { comparisonKey: 'new-chrome' }, { runsPerRoute: 1 }]) assert.equal(comparableBaseline([{ ...first, ...patch }], current, 'landing'), null);
});
test('archive appends new batches, exposes download metadata and preserves the other environment', async t => {
  const root = await temporary(t), incoming = path.join(root, 'incoming'), data = path.join(root, 'data');
  await fs.mkdir(path.join(incoming, 'production'), { recursive: true });
  await fs.mkdir(path.join(data, 'history'), { recursive: true });
  await fs.writeFile(path.join(data, 'history', '99-1-staging.json'), JSON.stringify(summary({ id: '99-1-staging', environment: 'staging' })));
  await fs.writeFile(path.join(incoming, 'production', 'summary.json'), JSON.stringify(summary()));
  const options = { config, dataDirectory: data, incomingDirectory: incoming, artifactList: [{ id: 123, name: 'lighthouse-production-100-1', expires_at: '2026-12-11T00:00:00Z' }], runId: '100', runAttempt: '1', environments: ['production'] };
  const first = await archive(options), second = await archive(options);
  assert.equal(first.history.length, 2); assert.equal(second.history.length, 2); assert.match(first.incoming[0].artifact.url, /artifacts\/123$/); assert.equal(latestRoutes(second.history, 'staging').size, 1);
});
test('missing collector output becomes a visible failed batch, not a stale success', async t => {
  const root = await temporary(t);
  const result = await archive({ config, dataDirectory: path.join(root, 'data'), incomingDirectory: path.join(root, 'missing'), artifactList: [], runId: '100', runAttempt: '1', environments: ['staging'] });
  assert.equal(result.incoming[0].routes.length, 9); assert.equal(result.incoming[0].routes.every(item => item.status === 'failed'), true); assert.equal(result.incoming[0].artifact, null);
});
test('dashboard build includes durable summaries and real downloadable page reports', async t => {
  const root = await temporary(t), source = path.join(root, 'sample'), output = path.join(root, 'dist');
  await fs.writeFile(`${source}.html`, '<!doctype html><title>Lighthouse test</title>'); await fs.writeFile(`${source}.json`, '{"test":true}');
  await build({ config, history: [summary()], webDirectory: new URL('../web', import.meta.url), outputDirectory: output, findReport: async () => source });
  const data = JSON.parse(await fs.readFile(path.join(output, 'data.json'), 'utf8'));
  assert.equal(data.reports.production.landing.summaryId, '100-1-production'); assert.equal(data.summaries.length, 1);
  assert.equal(await fs.readFile(path.join(output, 'reports/production/landing.json'), 'utf8'), '{"test":true}');
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'history/100-1-production.json'), 'utf8')).environment, 'production');
  assert.ok(await fs.stat(path.join(output, 'index.html')));
});
test('latest page data remains available after a manual subset collection', () => {
  const first = summary({ routes: [route(), route({ id: 'home' })] });
  const second = summary({ id: '101-1-production', generatedAt: '2026-11-11T13:17:00.000Z' });
  assert.equal(latestForRoute([first, second], 'production', 'home').summary.id, first.id);
  assert.equal(latestForRoute([first, second], 'production', 'landing').summary.id, second.id);
});
test('trend series excludes failed samples and incompatible measurement profiles', () => {
  const first = summary();
  const failed = summary({ id: '101-1-production', generatedAt: '2026-11-11T08:17:00.000Z', routes: [route({ status: 'failed' })] });
  const second = summary({ id: '102-1-production', generatedAt: '2026-11-11T13:17:00.000Z' });
  const wrong = summary({ id: '99-1-staging', environment: 'staging' });
  assert.equal(seriesFor([first, failed, second, wrong], 'production', 'landing', 'performance', 7, Date.parse(second.generatedAt)).length, 2);
  assert.equal(seriesFor([first, second], 'production', 'landing', 'performance', 7, Date.parse('2026-12-11')).length, 0);
});
test('report links expire honestly and user-controlled strings are escaped', () => {
  assert.equal(artifactAvailable({ url: 'https://github.com/example', expiresAt: '2026-11-12' }, Date.parse('2026-11-11')), true);
  assert.equal(artifactAvailable({ url: 'https://github.com/example', expiresAt: '2026-11-11' }, Date.parse('2026-11-11')), false);
  assert.equal(artifactAvailable(null), false); assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
test('all dashboard translations exist in both supported locales', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.zh).sort());
});
test('deployment is gated and monitoring uses both environments with retained evidence', async () => {
  const workflow = parse(await fs.readFile(new URL('../.github/workflows/monitor.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.jobs['quality-gate'].name, 'Required Quality Gate');
  assert.ok(workflow.jobs.deploy.needs.includes('quality-gate'));
  assert.ok(workflow.jobs.publish.needs.includes('quality-gate'));
  assert.equal(workflow.on.schedule[0].cron, '17 1,13 * * *');
  const upload = workflow.jobs.collect.steps.find(step => step.name === 'Archive full reports');
  assert.equal(upload.if, 'always()'); assert.equal(upload.with['retention-days'], config.reportRetentionDays);
  assert.equal(workflow.jobs.collect.strategy['fail-fast'], false);
  assert.equal(workflow.jobs['collection-health'].needs.includes('deploy'), true);
});

test('a collector infrastructure failure keeps earlier valid trend points visible', () => {
  const prior = summary();
  const failed = summary({ id: '101-1-production', generatedAt: '2026-11-11T13:17:00.000Z', comparisonKey: null, routes: [route({ status: 'failed' })] });
  assert.equal(seriesFor([prior, failed], 'production', 'landing', 'performance', 0).length, 1);
  assert.equal(latestForRoute([prior, failed], 'production', 'landing').route.status, 'failed');
});

test('loading, errors and empty data keep the correct message when language changes', () => {
  for (const locale of ['zh', 'en']) {
    const failed = dataPresentation({ loading: false, error: true, data: null });
    assert.equal(messages[locale][failed.key], messages[locale].loadError);
    assert.equal(failed.retry, true);
    assert.equal(messages[locale][dataPresentation({ loading: false, error: false, data: { summaries: [] } }).key], messages[locale].empty);
  }
  assert.equal(dataPresentation({ loading: true, error: false, data: { summaries: [summary()] } }).hidden, false);
  assert.equal(dataPresentation({ loading: false, error: false, data: { summaries: [summary()] } }).hidden, true);
});

test('first history publication works from a detached worktree to a new remote branch', async t => {
  const root = await temporary(t), remote = path.join(root, 'remote.git'), working = path.join(root, 'working');
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--bare', remote]); git(['init', working]);
  git(['config', 'user.name', 'Lighthouse test'], working); git(['config', 'user.email', 'test@example.invalid'], working);
  git(['commit', '--allow-empty', '-m', 'Initial'], working); git(['checkout', '--detach'], working); git(['remote', 'add', 'origin', remote], working);
  assert.equal(saveHistory(working, 'Empty initial history'), false);
  await fs.mkdir(path.join(working, 'history')); await fs.writeFile(path.join(working, 'history', '100-1-production.json'), JSON.stringify(summary()));
  assert.equal(saveHistory(working, 'Archive first batch'), true);
  assert.match(git(['--git-dir', remote, 'show', 'refs/heads/monitor-data:history/100-1-production.json']), /production/);
  assert.equal(saveHistory(working, 'Idempotent archive'), false);
  await fs.writeFile(path.join(working, 'history', '101-1-production.json'), JSON.stringify(summary({ id: '101-1-production' })));
  assert.equal(saveHistory(working, 'Archive second batch'), true);
});

test('pipeline health distinguishes a publish-only push from missing requested measurements', () => {
  const published = { event: 'push', collection: 'skipped', publish: 'success', deploy: 'success' };
  assert.equal(pipelineHealthy({ failed: 0 }, published), true);
  assert.equal(pipelineHealthy({ failed: 0 }, { ...published, event: 'workflow_dispatch' }), false);
  assert.equal(pipelineHealthy({ failed: 0 }, { ...published, event: 'schedule', collection: 'success', editorCollection: 'success' }), true);
  assert.equal(pipelineHealthy({ failed: 1 }, { ...published, collection: 'success' }), false);
  assert.equal(pipelineHealthy({ failed: 0 }, { ...published, deploy: 'failure' }), false);
});

test('quality status includes the other Lighthouse categories even with a high performance score', () => {
  const result = summarizeRoute(config.routes[0], [{ metrics: { ...metrics, performance: 99, bestPractices: 50 }, report: 'sample' }], [], 1, config);
  assert.equal(result.metrics.performance, 99);
  assert.equal(result.status, 'critical');
});

test('English AI ads is included in scheduled staging collection and keeps the exact supplied URL', () => {
  const all = selectPlan(config, { environment: 'staging' });
  const selected = selectPlan(config, { environment: 'staging', routes: 'ai-ads-en' });
  assert.equal(all.routes.length, 9);
  assert.equal(selected.routes.length, 1);
  assert.equal(new URL(selected.routes[0].path, selected.origin).href, 'https://vidmaeditor-ios.web.app/en/ai-ads/');
  assert.equal(messages.zh[selected.routes[0].labelKey], 'AI 广告（英文）');
  assert.equal(selectPlan(config, { environment: 'production' }).routes.length, 8);
  assert.throws(() => selectPlan(config, { environment: 'production', routes: 'ai-ads-en' }), /unavailable/);
});

test('route environment scopes reject unknown, empty and duplicate environments', () => {
  for (const scope of [[], ['unknown'], ['staging', 'staging'], 'staging']) {
    const invalid = structuredClone(config); invalid.routes.at(-1).environments = scope;
    assert.throws(() => validateConfig(invalid), /scope/);
  }
});

test('production collector failure summaries exclude staging-only pages', async t => {
  const root = await temporary(t);
  const result = await archive({ config, dataDirectory: path.join(root, 'data'), incomingDirectory: path.join(root, 'missing'), artifactList: [], runId: '100', runAttempt: '1', environments: ['production'] });
  assert.equal(result.incoming[0].routes.length, 8);
  assert.equal(result.incoming[0].routes.some(route => route.id === 'ai-ads-en'), false);
});
