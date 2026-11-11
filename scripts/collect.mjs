import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash, runCollection, selectPlan } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'monitor.config.json'), 'utf8'));
const options = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--(environment|routes|runs)=(.*)$/.exec(value);
  if (!match) throw new Error('Use --environment=production|staging --routes=id,id --runs=1..5');
  return [match[1], match[2]];
}));
const plan = selectPlan(config, options);
const output = path.join(root, 'artifacts', plan.environment);
await fs.mkdir(path.join(output, 'reports'), { recursive: true });
const generatedAt = new Date().toISOString();
const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';
const { default: lighthouse } = await import('lighthouse');
const { launch } = await import('chrome-launcher');
const lighthouseVersion = JSON.parse(await fs.readFile(path.join(root, 'node_modules/lighthouse/package.json'), 'utf8')).version;
const chromePath = process.env.CHROME_PATH;
const chromeVersion = chromePath ? execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim() : 'system-chrome';
let siteSnapshot;
try {
  const response = await fetch(`${plan.origin}/zh/`, { signal: AbortSignal.timeout(20000) });
  siteSnapshot = { url: response.url, httpStatus: response.status, htmlSha256: hash(await response.text()), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), sourceRevision: null };
} catch (error) { siteSnapshot = { error: error.message, sourceRevision: null }; }
const metadata = {
  id: `${runId}-${runAttempt}-${plan.environment}`, generatedAt, runId, runAttempt,
  collectorSha: process.env.GITHUB_SHA ?? null,
  workflowUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${config.repository}/actions/runs/${runId}` : null,
  versions: { lighthouse: lighthouseVersion, chrome: chromeVersion, node: process.version, platform: process.platform, runner: process.env.RUNNER_OS ? 'ubuntu-24.04-github-hosted' : 'local' },
  comparisonKey: hash({ profile: config.profile, routes: config.routes, lighthouseVersion, chromeVersion, platform: process.platform, runner: process.env.RUNNER_OS ? 'ubuntu-24.04-github-hosted' : 'local' }),
  siteSnapshot,
};
let chrome;
let launchError;
try { chrome = await launch({ chromePath, chromeFlags: ['--headless=new', '--disable-dev-shm-usage', '--no-sandbox'] }); }
catch (error) { launchError = error; }
let summary;
try {
  summary = await runCollection({
    config, plan, metadata,
    audit: url => {
      if (launchError) throw launchError;
      const { id, ...settings } = config.profile;
      return lighthouse(url, { ...settings, port: chrome.port, output: ['html', 'json'], logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], locale: 'zh' });
    },
    saveReport: async (name, result) => {
      const [html, json] = result.report;
      await Promise.all([
        fs.writeFile(path.join(output, 'reports', `${name}.html`), html),
        fs.writeFile(path.join(output, 'reports', `${name}.json`), json),
      ]);
    },
    onProgress: ({ route, index, attempt }) => console.log(`${plan.environment}/${route}: ${index}/${plan.runs}, attempt ${attempt}`),
  });
} finally { if (chrome) await chrome.kill(); }
summary.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
const failed = summary.routes.filter(route => route.status === 'failed');
const table = summary.routes.map(route => `| ${route.id} | ${route.status} | ${route.metrics.performance ?? '—'} | ${route.metrics.lcpMs == null ? '—' : Math.round(route.metrics.lcpMs)} | ${route.successCount}/${route.expectedCount} |`).join('\n');
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${plan.environment}\n\n| Route | Status | Performance | LCP ms | Samples |\n| --- | --- | --- | --- | --- |\n${table}\n\n`);
console.log(`Saved ${summary.routes.length} routes, ${failed.length} incomplete. Reports are archived before the final health check.`);
