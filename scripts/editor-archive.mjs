import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readHistory } from './archive.mjs';
import { summarizeEditor } from '../web/editor-model.mjs';
export async function archiveEditor({ config, editorConfig, dataDirectory, incomingDirectory, artifacts, environments, runId, attempt, expectedRuns = config.runs, now = new Date() }) {
  const directory = path.join(dataDirectory, 'editor-history');
  const history = await readHistory(directory), additions = [];
  for (const environment of environments) {
    let batch;
    try { batch = JSON.parse(await fs.readFile(path.join(incomingDirectory, `editor-${environment}`, 'summary.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      batch = { schemaVersion: 1, kind: 'editor-benchmark', id: `${runId}-${attempt}-editor-${environment}`, environment, origin: config.environments[environment].origin, path: editorConfig.path, generatedAt: now.toISOString(), runsPerBatch: expectedRuns, comparisonKey: null, versions: {}, fixture: editorConfig.fixture, targets: editorConfig.targets, critical: editorConfig.critical, runs: [], failures: [{ stage: 'collector', message: 'Editor collector did not produce a summary' }] };
      batch.summary = summarizeEditor([], batch.runsPerBatch, editorConfig);
    }
    if (!/^[a-zA-Z0-9-]+$/.test(batch.id) || batch.id !== `${runId}-${attempt}-editor-${environment}` || batch.environment !== environment || batch.kind !== 'editor-benchmark') throw new Error('Invalid editor batch identity');
    const artifact = artifacts.find(item => item.name === `editor-${environment}-${runId}-${attempt}`);
    batch.artifact = artifact ? { id: artifact.id, url: `https://github.com/${config.repository}/actions/runs/${runId}/artifacts/${artifact.id}`, expiresAt: artifact.expires_at } : null;
    batch.runs = batch.runs.map(run => ({ ...run, detail: { source: run.detail?.source, editedDurationMs: run.detail?.editedDurationMs, export: run.detail?.export } }));
    if (!history.some(item => item.id === batch.id)) { await fs.writeFile(path.join(directory, `${batch.id}.json`), JSON.stringify(batch)); history.push(batch); }
    additions.push(batch);
  }
  return { history, additions };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await fs.readFile('monitor.config.json','utf8')), editorConfig = JSON.parse(await fs.readFile('editor-benchmark.config.json','utf8'));
  const response = await fetch(`https://api.github.com/repos/${config.repository}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts?per_page=100`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } });
  if (!response.ok) throw new Error(`Artifact metadata unavailable: ${response.status}`);
  const { artifacts } = await response.json();
  const result = await archiveEditor({ config, editorConfig, dataDirectory: 'monitor-data', incomingDirectory: 'incoming', artifacts, environments: process.env.TARGET_ENVIRONMENTS.split(','), runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, expectedRuns: Number(process.env.EXPECTED_EDITOR_RUNS || config.runs) });
  await fs.mkdir('artifacts',{recursive:true});
  const health = await fs.readFile('artifacts/health.json','utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return {failed:0,summaries:[]};});
  health.failed += result.additions.filter(batch=>batch.summary.overall==='failed').length;
  health.summaries.push(...result.additions.map(batch=>batch.id));
  await fs.writeFile('artifacts/health.json',JSON.stringify(health));
}
