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
import { latestForRoute } from '../web/model.mjs';
import { retiredAccountRoutes } from './account-entry-fixtures.mjs';

const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
const additions = {
  asset: '/en/asset/', 'ai-sprite': '/en/video-to-sprite/',
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

for (const environment of ['production', 'staging']) for (const device of ['desktop', 'mobile']) test(`${environment}/${device}: all 12 additional English tools and entries collect three samples`, async () => {
  const plan = selectPlan(config, { environment, device, routes: ids.join(',') });
  assert.equal(plan.routes.length, ids.length);
  const visited = [], saved = [];
  const result = await runCollection({ config, plan, metadata: { id: `coverage-${device}` }, audit: async url => { visited.push(url); return report(url); }, saveReport: async (name, data) => saved.push({ name, data }) });
  assert.equal(visited.length, 36); assert.equal(saved.length, 36);
  for (const route of result.routes) {
    assert.equal(route.path, additions[route.id]);
    assert.equal(visited.filter(url => url === `${plan.origin}${route.path}`).length, 3);
    assert.equal(route.successCount, 3); assert.equal(route.status, 'pass');
    if (route.seoPolicy) {
      assert.equal(route.metrics.seo, 66); assert.equal(route.seoAssessment.noindexConfirmed, true); assert.equal(route.seoAssessment.otherScore, 100);
      assert.equal(JSON.parse(saved.find(item => item.name.startsWith(`${route.id}-`)).data.report[1]).categories.seo.score, .66);
    }
  }
});

test('the schedule measures identical routes on both environments and devices', async t => {
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
    assert.deepEqual(plan.routes, config.routes);
    assert.deepEqual(plan.routes.map(route => route.id), ['landing', 'home', 'subscribe', 'ai-video', 'video-create', 'image-create', 'tools', 'clothes-transfer', 'editor', 'ai-ads-en', ...ids]);
  }
});

test('measurement scopes reject typos and keep unrelated public pages unrestricted', () => {
  for (const scope of ['', null, 'authenticated', {}, []]) {
    const wrong = structuredClone(config); wrong.routes.push({ ...retiredAccountRoutes[0], measurementScope: scope });
    assert.throws(() => validateConfig(wrong), /measurement scope/);
  }
  assert.equal(config.routes.find(route => route.id === 'asset').measurementScope, undefined);
  assert.equal(retiredAccountRoutes[1].seoPolicy, undefined);
});

test('aligning coverage preserves retired account and plans histories and downloadable reports', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'staging-reports-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const incoming = path.join(directory, 'incoming'), dataDirectory = path.join(directory, 'data'), output = path.join(directory, 'dist');
  const history = path.join(dataDirectory, 'history'); await fs.mkdir(history, { recursive: true });
  const oldPlansRoute = { id: 'subscribe-login', labelKey: 'subscribeLogin', path: '/en/subscribe/', environments: ['production'] };
  const oldPlansConfig = { ...config, routes: [oldPlansRoute] };
  const oldPlansPlan = selectPlan(oldPlansConfig, { environment: 'production' });
  const oldPlansReports = path.join(directory, 'old-plans');
  await fs.mkdir(oldPlansReports);
  const legacy = await runCollection({
    config: oldPlansConfig, plan: oldPlansPlan,
    metadata: { id: 'old-production', generatedAt: '2026-11-10T00:00:00Z', comparisonKey: 'old' },
    audit: async url => report(url),
    saveReport: async (name, result) => {
      await fs.writeFile(path.join(oldPlansReports, `${name}.html`), result.report[0]);
      await fs.writeFile(path.join(oldPlansReports, `${name}.json`), result.report[1]);
    },
  });
  const oldBytes = JSON.stringify(legacy); await fs.writeFile(path.join(history, `${legacy.id}.json`), oldBytes);
  const oldAccounts = [];
  const legacyConfig = { ...config, routes: [...config.routes, ...retiredAccountRoutes] };
  for (const device of ['desktop', 'mobile']) {
    const folder = path.join(directory, 'old-reports', device); await fs.mkdir(folder, { recursive: true });
    const plan = selectPlan(legacyConfig, { environment: 'staging', device, routes: 'orders-login,credits-login' });
    const summary = await runCollection({ config: legacyConfig, plan, metadata: { id: `old-accounts-${device}`, generatedAt: '2026-11-16T00:00:00Z', comparisonKey: 'legacy' }, audit: async url => report(url), saveReport: async (name, result) => { for (const [index, ext] of ['html', 'json'].entries()) await fs.writeFile(path.join(folder, `${name}.${ext}`), result.report[index]); } });
    const bytes = JSON.stringify(summary); await fs.writeFile(path.join(history, `${summary.id}.json`), bytes);
    oldAccounts.push({ summary, bytes });
  }
  for (const device of ['desktop', 'mobile']) {
    const plan = selectPlan(config, { environment: 'staging', device, routes: ids.join(',') });
    const folder = path.join(incoming, device === 'mobile' ? 'mobile/staging' : 'staging'); await fs.mkdir(path.join(folder, 'reports'), { recursive: true });
    const summary = await runCollection({ config, plan, metadata: { id: `900-1-staging${device === 'mobile' ? '-mobile' : ''}`, generatedAt: '2026-11-17T00:00:00Z', comparisonKey: 'coverage' }, audit: async url => report(url), saveReport: async (name, result) => { for (const [index, ext] of ['html', 'json'].entries()) await fs.writeFile(path.join(folder, 'reports', `${name}.${ext}`), result.report[index]); } });
    await fs.writeFile(path.join(folder, 'summary.json'), JSON.stringify(summary));
  }
  const archived = await archive({ config, dataDirectory, incomingDirectory: incoming, artifactList: [], runId: '900', runAttempt: '1', environments: ['staging'], devices: ['desktop', 'mobile'], routes: ids.join(',') });
  assert.equal(archived.history.length, 5); assert.equal(await fs.readFile(path.join(history, `${legacy.id}.json`), 'utf8'), oldBytes);
  for (const { summary, bytes } of oldAccounts) assert.equal(await fs.readFile(path.join(history, `${summary.id}.json`), 'utf8'), bytes);
  await build({
    config, history: archived.history, webDirectory: new URL('../web/', import.meta.url), outputDirectory: output,
    findReport: async (summary, reportName) => {
      if (summary.id === legacy.id) return path.join(oldPlansReports, reportName);
      if (summary.id.startsWith('old-accounts-')) return path.join(directory, 'old-reports', summary.device, reportName);
      return path.join(incoming, summary.device === 'mobile' ? 'mobile/staging' : 'staging', 'reports', reportName);
    },
  });
  const data = JSON.parse(await fs.readFile(path.join(output, 'data.json'), 'utf8'));
  assert.equal(await fs.readFile(path.join(output, 'history', `${legacy.id}.json`), 'utf8'), oldBytes);
  assert.equal(latestForRoute(data.summaries, 'production', 'subscribe-login').summary.id, legacy.id);
  assert.equal(latestForRoute(data.summaries, 'production', 'subscribe'), null);
  const oldPlansLink = data.reportsByDevice.desktop.production['subscribe-login'];
  assert.equal(oldPlansLink.summaryId, legacy.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(output, oldPlansLink.json), 'utf8')).requestedUrl, 'https://vidma.ai/en/subscribe/');
  for (const device of ['desktop', 'mobile']) {
    const summary = data.summariesByDevice[device].find(item => item.id.startsWith('900-'));
    assert.ok(summary.routes.every(route => !retiredAccountRoutes.some(old => old.id === route.id)));
    const old = oldAccounts.find(item => item.summary.device === device);
    assert.equal(await fs.readFile(path.join(output, 'history', `${old.summary.id}.json`), 'utf8'), old.bytes);
    const historical = data.summariesByDevice[device].find(item => item.id === old.summary.id);
    for (const route of retiredAccountRoutes) {
      assert.equal(historical.routes.find(item => item.id === route.id).measurementScope, 'sign-in-entry');
      const link = data.reportsByDevice[device].staging[route.id]; assert.equal(link.summaryId, old.summary.id);
      assert.equal(JSON.parse(await fs.readFile(path.join(output, link.json), 'utf8')).requestedUrl, `https://vidmaeditor-ios.web.app${route.path}`);
      assert.match(await fs.readFile(path.join(output, link.html), 'utf8'), /Measured fixture/);
    }
    for (const id of ids) {
      const link = data.reportsByDevice[device].staging[id]; assert.ok(link);
      const json = JSON.parse(await fs.readFile(path.join(output, link.json), 'utf8'));
      assert.equal(json.requestedUrl, `https://vidmaeditor-ios.web.app${additions[id]}`);
      assert.match(await fs.readFile(path.join(output, link.html), 'utf8'), /Measured fixture/);
    }
  }
});

for (const environment of ['production', 'staging']) for (const device of ['desktop', 'mobile']) test(`${environment}/${device}: retired account routes cannot be scheduled or selected manually`, () => {
  for (const route of retiredAccountRoutes) {
    assert.equal(config.routes.some(item => item.id === route.id), false);
    assert.throws(() => selectPlan(config, { environment, device, routes: route.id }), /unavailable/);
  }
});
