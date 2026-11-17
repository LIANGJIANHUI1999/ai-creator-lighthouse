import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { selectPlan, validateConfig, runCollection } from '../scripts/lib.mjs';
import { archive } from '../scripts/archive.mjs';
import { build } from '../scripts/build.mjs';

const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
const additions = {
  asset: '/en/asset/', 'ai-sprite': '/en/video-to-sprite/',
  'orders-login': '/en/account/orders/', 'credits-login': '/en/account/credits/',
  'image-edit': '/en/tools/image-edit/', 'character-sheet': '/en/tools/character-sheet/',
  'portrait-edit': '/en/tools/portrait-edit/', 'bust-enhancer': '/en/tools/bust-enhancer/',
  'face-swap': '/en/tools/face-swap/', 'logo-generator': '/en/tools/ai-logo-generator/',
  'video-compress': '/en/tools/video-compress/', 'video-to-sprite': '/en/tools/video-to-sprite/',
  subtitles: '/en/tools/subtitles/', 'subtitle-translation': '/en/tools/subtitle-translation/',
};
const ids = Object.keys(additions);
function report(url) {
  const noindex = ['/en/asset/', '/en/account/orders/'].includes(new URL(url).pathname);
  const lhr = {
    requestedUrl: url, finalDisplayedUrl: url,
    categories: { performance: { score: .98 }, accessibility: { score: 1 }, 'best-practices': { score: 1 }, seo: { score: noindex ? .66 : 1, auditRefs: [{ id: 'is-crawlable', weight: 1 }, { id: 'document-title', weight: 1 }] } },
    audits: { 'http-status-code': { score: 1 }, 'largest-contentful-paint': { numericValue: 1000 }, 'cumulative-layout-shift': { numericValue: 0 }, 'total-blocking-time': { numericValue: 10 }, 'document-title': { score: 1 }, 'is-crawlable': { score: noindex ? 0 : 1, details: { items: noindex ? [{ source: '<meta name="robots" content="noindex, nofollow">' }] : [] } } },
  };
  return { lhr, report: ['<!doctype html><title>Measured fixture</title>', JSON.stringify(lhr)] };
}

for (const device of ['desktop', 'mobile']) test(`${device}: all 14 additions are English staging-only and collect three samples`, async () => {
  const plan = selectPlan(config, { environment: 'staging', device, routes: ids.join(',') });
  assert.equal(plan.routes.length, 14);
  assert.equal(selectPlan(config, { environment: 'staging', device }).routes.length, 24);
  assert.equal(selectPlan(config, { environment: 'production', device }).routes.length, 9);
  const visited = [], saved = [];
  const result = await runCollection({ config, plan, metadata: { id: `coverage-${device}` }, audit: async url => { visited.push(url); return report(url); }, saveReport: async (name, data) => saved.push({ name, data }) });
  assert.equal(visited.length, 42); assert.equal(saved.length, 42);
  for (const route of result.routes) {
    assert.equal(route.path, additions[route.id]);
    assert.deepEqual(route.environments, ['staging']);
    assert.equal(visited.filter(url => url === `https://vidmaeditor-ios.web.app${route.path}`).length, 3);
    assert.equal(route.successCount, 3); assert.equal(route.status, 'pass');
    assert.throws(() => selectPlan(config, { environment: 'production', device, routes: route.id }), /unavailable/);
    if (['orders-login', 'credits-login'].includes(route.id)) assert.equal(route.measurementScope, 'sign-in-entry');
    if (route.seoPolicy) {
      assert.equal(route.metrics.seo, 66); assert.equal(route.seoAssessment.noindexConfirmed, true); assert.equal(route.seoAssessment.otherScore, 100);
      assert.equal(JSON.parse(saved.find(item => item.name.startsWith(`${route.id}-`)).data.report[1]).categories.seo.score, .66);
    }
  }
});

test('scheduled matrix includes both devices and the expanded staging list while retaining the original cron', async t => {
  const workflow = parse(await fs.readFile('.github/workflows/monitor.yml', 'utf8'));
  assert.deepEqual(workflow.on.schedule, [{ cron: '17 1,13 * * *' }]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'staging-plan-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'plan');
  const script = workflow.jobs['quality-gate'].steps.find(step => step.id === 'plan').run;
  execFileSync('bash', ['-c', script], { env: { ...process.env, TARGET: 'all', DEVICE: 'all', SUITE: 'all', ROUTES: '', RUNS: '3', GITHUB_OUTPUT: output }, stdio: 'pipe' });
  const values = Object.fromEntries((await fs.readFile(output, 'utf8')).trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const matrix = JSON.parse(values.collect_matrix).include;
  assert.deepEqual(matrix.map(target => [target.environment, target.device]), [['production', 'desktop'], ['production', 'mobile'], ['staging', 'desktop'], ['staging', 'mobile']]);
  for (const target of matrix) {
    const plan = selectPlan(config, target);
    assert.equal(plan.runs, 3);
    assert.equal(plan.routes.filter(route => ids.includes(route.id)).length, target.environment === 'staging' ? 14 : 0);
  }
});

test('measurement scopes reject typos and keep unrelated public pages unrestricted', () => {
  for (const scope of ['', null, 'authenticated', {}, []]) {
    const wrong = structuredClone(config); wrong.routes.find(route => route.id === 'orders-login').measurementScope = scope;
    assert.throws(() => validateConfig(wrong), /measurement scope/);
  }
  assert.equal(config.routes.find(route => route.id === 'asset').measurementScope, undefined);
  assert.equal(config.routes.find(route => route.id === 'credits-login').seoPolicy, undefined);
});

test('expanded pages retain historical batches, signed-out scope and separate downloadable reports for both devices', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'staging-reports-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const incoming = path.join(directory, 'incoming'), dataDirectory = path.join(directory, 'data'), output = path.join(directory, 'dist');
  const history = path.join(dataDirectory, 'history'); await fs.mkdir(history, { recursive: true });
  const legacy = { schemaVersion: 1, id: 'old-production', environment: 'production', generatedAt: '2026-11-10T00:00:00Z', routes: [], versions: {}, comparisonKey: 'old' };
  const oldBytes = JSON.stringify(legacy); await fs.writeFile(path.join(history, `${legacy.id}.json`), oldBytes);
  for (const device of ['desktop', 'mobile']) {
    const plan = selectPlan(config, { environment: 'staging', device, routes: ids.join(',') });
    const folder = path.join(incoming, device === 'mobile' ? 'mobile/staging' : 'staging'); await fs.mkdir(path.join(folder, 'reports'), { recursive: true });
    const summary = await runCollection({ config, plan, metadata: { id: `900-1-staging${device === 'mobile' ? '-mobile' : ''}`, generatedAt: '2026-11-17T00:00:00Z', comparisonKey: 'coverage' }, audit: async url => report(url), saveReport: async (name, result) => { for (const [index, ext] of ['html', 'json'].entries()) await fs.writeFile(path.join(folder, 'reports', `${name}.${ext}`), result.report[index]); } });
    await fs.writeFile(path.join(folder, 'summary.json'), JSON.stringify(summary));
  }
  const archived = await archive({ config, dataDirectory, incomingDirectory: incoming, artifactList: [], runId: '900', runAttempt: '1', environments: ['staging'], devices: ['desktop', 'mobile'], routes: ids.join(',') });
  assert.equal(archived.history.length, 3); assert.equal(await fs.readFile(path.join(history, `${legacy.id}.json`), 'utf8'), oldBytes);
  await build({ config, history: archived.history, webDirectory: new URL('../web/', import.meta.url), outputDirectory: output, findReport: async (summary, reportName) => path.join(incoming, summary.device === 'mobile' ? 'mobile/staging' : 'staging', 'reports', reportName) });
  const data = JSON.parse(await fs.readFile(path.join(output, 'data.json'), 'utf8'));
  for (const device of ['desktop', 'mobile']) {
    const summary = data.summariesByDevice[device].find(item => item.environment === 'staging');
    assert.equal(summary.routes.find(route => route.id === 'orders-login').measurementScope, 'sign-in-entry');
    for (const id of ids) {
      const link = data.reportsByDevice[device].staging[id]; assert.ok(link);
      const json = JSON.parse(await fs.readFile(path.join(output, link.json), 'utf8'));
      assert.equal(json.requestedUrl, `https://vidmaeditor-ios.web.app${additions[id]}`);
      assert.match(await fs.readFile(path.join(output, link.html), 'utf8'), /Measured fixture/);
    }
  }
});
