import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { hash, selectPlan } from './lib.mjs';
import { runEditorScenario } from './editor-scenario.mjs';
import { summarizeEditor, validateEditorConfig } from '../web/editor-model.mjs';
import { renderEditorReport } from '../web/editor-view.mjs';

if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Unattended collector is for Linux GitHub Actions. Use the project ego-browser benchmark locally.');
if (spawnSync('which', ['ego-browser']).status === 0) throw new Error('ego-browser is available; use the ego-browser runner on this machine.');
const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
const editorConfig = validateEditorConfig(JSON.parse(await fs.readFile('editor-benchmark.config.json', 'utf8')));
const options = Object.fromEntries(process.argv.slice(2).map(value => { const match = /^--(environment|runs)=(.*)$/.exec(value); if (!match) throw new Error('Use --environment=production|staging --runs=1..5'); return [match[1], match[2]]; }));
const plan = selectPlan(config, { environment: options.environment, runs: options.runs ?? config.runs });
const fixturePath = path.resolve(editorConfig.fixture.file);
if (hash(await fs.readFile(fixturePath)) !== editorConfig.fixture.sha256) throw new Error('Fixture hash mismatch');
const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error('CHROME_PATH is required');
const chromeVersion = execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim();
const generatedAt = new Date().toISOString();
const runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT;
const output = path.join('artifacts', `editor-${plan.environment}`);
await fs.mkdir(output, { recursive: true });
const { default: puppeteer } = await import('puppeteer-core');
const runs = [], failures = [];
let browser;
let renderer = null;
try {
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  for (let index = 1; index <= plan.runs; index++) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setViewport({ width: 1350, height: 940, deviceScaleFactor: 1 });
      await page.setCacheEnabled(false);
      const result = await runEditorScenario(page, { url: new URL(editorConfig.path, plan.origin).href, fixturePath, config: editorConfig });
      renderer ??= await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl');
        const extension = gl?.getExtension('WEBGL_debug_renderer_info');
        return gl ? String(gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) : 'unavailable';
      });
      runs.push({ index, ...result });
      failures.push(...result.failures.map(error => ({ run: index, ...error })));
      await fs.writeFile(path.join(output, `run-${index}.json`), JSON.stringify(result, null, 2));
      console.log(`${plan.environment}: editor ${index}/${plan.runs}, ${result.failures.length} failed stages`);
    } catch (error) {
      const metrics = Object.fromEntries(Object.keys(editorConfig.targets).map(key => [key, null]));
      runs.push({ index, metrics, failures: [{ stage: 'browser', message: error.message }], detail: {} });
      failures.push({ run: index, stage: 'browser', message: error.message });
    } finally { await context.close(); }
  }
} catch (error) { failures.push({ stage: 'launch', message: error.message }); }
finally { if (browser) await browser.close(); }
const engines = [...new Set(runs.map(run => run.detail?.export?.engine).filter(Boolean))].sort();
const versions = { chrome: chromeVersion, node: process.version, puppeteer: JSON.parse(await fs.readFile('node_modules/puppeteer-core/package.json', 'utf8')).version, renderer, engines, platform: process.platform, cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, runner: 'ubuntu-24.04-github-hosted', softwareRendering: true };
const summary = {
  schemaVersion: 1, kind: 'editor-benchmark', id: `${runId}-${attempt}-editor-${plan.environment}`, environment: plan.environment,
  generatedAt, finishedAt: new Date().toISOString(), runId, runAttempt: attempt, collectorSha: process.env.GITHUB_SHA,
  origin: plan.origin, path: editorConfig.path, runsPerBatch: plan.runs, fixture: editorConfig.fixture, scenarioVersion: editorConfig.scenarioVersion,
  versions, comparisonKey: engines.length === 1 && renderer ? hash({ config: editorConfig, versions }) : null, targets: editorConfig.targets, critical: editorConfig.critical,
  workflowUrl: `https://github.com/${config.repository}/actions/runs/${runId}`, summary: summarizeEditor(runs, plan.runs, editorConfig), runs, failures,
};
await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
const css = await fs.readFile('web/styles.css', 'utf8');
await fs.writeFile(path.join(output, 'index.html'), renderEditorReport(summary, 'zh', css));
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Editor · ${plan.environment}\n\nComplete samples: ${summary.summary.successCount}/${plan.runs}. Status: ${summary.summary.overall}. Engine: ${engines.join(', ') || 'unavailable'}. Software-rendered Linux lab benchmark.\n\n`);
console.log(`Editor evidence saved; overall=${summary.summary.overall}. Incomplete metrics fail health after publication.`);
