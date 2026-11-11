import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { comparableBaseline, regression, validateConfig } from './lib.mjs';

export function mergeHistory(history, incoming) {
  const result = new Map(history.map(summary => [summary.id, summary]));
  for (const summary of incoming) {
    if (!/^[a-zA-Z0-9-]+$/.test(summary.id) || summary.schemaVersion !== 1 || !Array.isArray(summary.routes)) throw new Error('Invalid summary');
    if (!result.has(summary.id)) {
      for (const route of summary.routes) route.regressions = regression(route, comparableBaseline([...result.values()], summary, route.id));
      result.set(summary.id, summary);
    }
  }
  return [...result.values()].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt) || a.id.localeCompare(b.id));
}

export function latestRoutes(history, environment) {
  const routes = new Map();
  for (const summary of history.filter(s => s.environment === environment).toSorted((a, b) => a.generatedAt.localeCompare(b.generatedAt))) {
    for (const route of summary.routes) routes.set(route.id, { summary, route });
  }
  return routes;
}

export async function readHistory(directory) {
  await fs.mkdir(directory, { recursive: true });
  const files = (await fs.readdir(directory)).filter(file => /^[a-zA-Z0-9-]+\.json$/.test(file));
  return Promise.all(files.map(file => fs.readFile(path.join(directory, file), 'utf8').then(JSON.parse)));
}

async function github(endpoint) {
  const response = await fetch(`https://api.github.com${endpoint}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response.json();
}

export async function archive({ config, dataDirectory, incomingDirectory, artifactList, runId, runAttempt, environments, now = new Date() }) {
  validateConfig(config);
  const historyDirectory = path.join(dataDirectory, 'history');
  const history = await readHistory(historyDirectory);
  const incoming = [];
  for (const environment of environments) {
    let summary;
    try { summary = JSON.parse(await fs.readFile(path.join(incomingDirectory, environment, 'summary.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      summary = {
        schemaVersion: 1, id: `${runId}-${runAttempt}-${environment}`, environment, origin: config.environments[environment].origin,
        generatedAt: now.toISOString(), finishedAt: now.toISOString(), comparisonKey: null, versions: {}, runsPerRoute: config.runs,
        profile: config.profile, targets: config.targets, critical: config.critical, siteSnapshot: { sourceRevision: null },
        routes: config.routes.map(route => ({ ...route, metrics: {}, ranges: {}, successCount: 0, expectedCount: config.runs, status: 'failed', representative: null, errors: [{ message: 'Collector did not produce a summary' }], samples: [] })),
      };
    }
    if (summary.environment !== environment || summary.id !== `${runId}-${runAttempt}-${environment}`) throw new Error('Mismatched batch identity');
    const artifact = artifactList.find(item => item.name === `lighthouse-${environment}-${runId}-${runAttempt}`);
    summary.artifact = artifact ? { id: artifact.id, url: `https://github.com/${config.repository}/actions/runs/${runId}/artifacts/${artifact.id}`, expiresAt: artifact.expires_at } : null;
    summary.workflowUrl = `https://github.com/${config.repository}/actions/runs/${runId}`;
    incoming.push(summary);
  }
  const merged = mergeHistory(history, incoming);
  for (const summary of merged) if (!history.some(previous => previous.id === summary.id)) await fs.writeFile(path.join(historyDirectory, `${summary.id}.json`), JSON.stringify(summary));
  return { history: merged, incoming };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
  const artifactList = await github(`/repos/${config.repository}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts?per_page=100`);
  const result = await archive({ config, dataDirectory: 'monitor-data', incomingDirectory: 'incoming', artifactList: artifactList.artifacts, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, environments: (process.env.TARGET_ENVIRONMENTS ?? 'production,staging').split(',') });
  const failed = result.incoming.reduce((count, summary) => count + summary.routes.filter(route => route.status === 'failed').length, 0);
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/health.json', JSON.stringify({ failed, summaries: result.incoming.map(summary => summary.id) }));
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Monitoring archive\n\n${result.incoming.length} environment batches archived; ${failed} incomplete pages. Performance budget violations are visible on the dashboard and do not block reporting.\n\n`);
}
