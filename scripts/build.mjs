import fs from 'node:fs/promises';
import { renderEditorReport } from '../web/editor-view.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { latestRoutes, readHistory } from './archive.mjs';
import { devices, summaryDevice, collectionDirectory } from '../web/devices.mjs';

export async function build({ config, history, webDirectory, outputDirectory, findReport = async () => null, editorHistory = [], editorConfig = null, now = new Date() }) {
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.cp(webDirectory, outputDirectory, { recursive: true });
  await fs.mkdir(path.join(outputDirectory, 'history'), { recursive: true });
  const reportsByDevice = Object.fromEntries(devices.map(device => [device, {}]));
  for (const summary of history) await fs.writeFile(path.join(outputDirectory, 'history', `${summary.id}.json`), JSON.stringify(summary));
  for (const device of devices) for (const environment of Object.keys(config.environments)) {
    const reports = reportsByDevice[device];
    reports[environment] = {};
    const prefix = `reports/${environment}${device === 'mobile' ? '/mobile' : ''}`;
    const directory = path.join(outputDirectory, prefix);
    await fs.mkdir(directory, { recursive: true });
    for (const [id, { summary, route }] of latestRoutes(history, environment, device)) {
      if (!route.representative) continue;
      const source = await findReport(summary, route.representative);
      if (!source) continue;
      for (const extension of ['html', 'json']) await fs.copyFile(`${source}.${extension}`, path.join(directory, `${id}.${extension}`));
      reports[environment][id] = { summaryId: summary.id, html: `${prefix}/${id}.html`, json: `${prefix}/${id}.json` };
    }
  }
  await fs.mkdir(path.join(outputDirectory, 'editor-history'), { recursive: true });
  await fs.mkdir(path.join(outputDirectory, 'reports', 'editor'), { recursive: true });
  const css = await fs.readFile(path.join(webDirectory instanceof URL ? fileURLToPath(webDirectory) : webDirectory, 'styles.css'), 'utf8');
  for (const batch of editorHistory) {
    if (!/^[a-zA-Z0-9-]+$/.test(batch.id)) throw new Error('Invalid editor report identity');
    await fs.writeFile(path.join(outputDirectory, 'editor-history', `${batch.id}.json`), JSON.stringify(batch));
    await fs.writeFile(path.join(outputDirectory, 'reports', 'editor', `${batch.id}.html`), renderEditorReport(batch, 'zh', css));
  }
  const summaries = history.map(summary => ({ ...summary, routes: summary.routes.map(({ samples, errors, ...route }) => ({ ...route, errorCount: errors?.filter(error => !error.recovered).length ?? 0 })) }));
  const summariesByDevice = Object.fromEntries(devices.map(device => [device, summaries.filter(summary => summaryDevice(summary) === device)]));
  await fs.writeFile(path.join(outputDirectory, 'data.json'), JSON.stringify({ schemaVersion: 1, generatedAt: now.toISOString(), config, summaries: summariesByDevice.desktop, summariesByDevice, reports: reportsByDevice.desktop, reportsByDevice, editorSummaries: editorHistory, editorConfig }));
  await fs.writeFile(path.join(outputDirectory, '.nojekyll'), '');
  return { summaries: summaries.length, environments: Object.keys(config.environments) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
  const history = await readHistory('monitor-data/history');
  const editorHistory = await readHistory('monitor-data/editor-history');
  const editorConfig = JSON.parse(await fs.readFile('editor-benchmark.config.json','utf8'));
  const cache = new Map();
  const findReport = async (summary, report) => {
    if (!/^[a-zA-Z0-9-]+$/.test(report)) throw new Error('Invalid report name');
    const incoming = path.join('incoming', collectionDirectory(summary.environment, summaryDevice(summary)));
    let directory = path.join(incoming, 'reports');
    const current = await fs.readFile(path.join(incoming, 'summary.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (current?.id !== summary.id) {
      if (!summary.artifact || new Date(summary.artifact.expiresAt) <= new Date() || !process.env.GITHUB_TOKEN) return null;
      directory = path.join('artifacts', 'cache', summary.id);
      if (!cache.has(summary.id)) {
        cache.set(summary.id, (async () => {
          const response = await fetch(`https://api.github.com/repos/${config.repository}/actions/artifacts/${summary.artifact.id}/zip`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw new Error(`Artifact download returned ${response.status}`);
          await fs.mkdir(directory, { recursive: true });
          const zip = path.join(directory, 'artifact.zip');
          await fs.writeFile(zip, Buffer.from(await response.arrayBuffer()));
          execFileSync('unzip', ['-q', zip, '-d', directory]);
        })().then(() => true).catch(error => { console.warn(`Previous report unavailable: ${summary.id} (${error.message})`); return false; }));
      }
      if (!await cache.get(summary.id)) return null;
      directory = path.join(directory, 'reports');
    }
    const source = path.join(directory, report);
    const exists = await Promise.all(['html', 'json'].map(extension => fs.access(`${source}.${extension}`).then(() => true).catch(() => false)));
    return exists.every(Boolean) ? source : null;
  };
  console.log(await build({ config, history, webDirectory: 'web', outputDirectory: 'dist', findReport, editorHistory, editorConfig }));
}
