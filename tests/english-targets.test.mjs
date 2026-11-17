import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { hash, selectPlan, runCollection, comparableBaseline } from '../scripts/lib.mjs';
import { seriesFor } from '../web/model.mjs';
import { editorSeries, summarizeEditor, validateEditorConfig } from '../web/editor-model.mjs';

const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
const editorConfig = JSON.parse(await fs.readFile('editor-benchmark.config.json', 'utf8'));
const audit = async url => ({ lhr: {
  requestedUrl: url, finalDisplayedUrl: url,
  categories: Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo'].map(key => [key, { score: 1 }])),
  audits: { 'http-status-code': { score: 1 }, 'largest-contentful-paint': { numericValue: 500 }, 'cumulative-layout-shift': { numericValue: 0 }, 'total-blocking-time': { numericValue: 0 } },
} });

for (const environment of ['production', 'staging']) for (const device of ['desktop', 'mobile']) {
  test(`${environment}/${device} collects every configured page in English with its query parameters`, async () => {
    const plan = selectPlan(config, { environment, device, runs: 1 });
    assert.equal(plan.routes.length, environment === 'production' ? 9 : 22);
    const visited = [];
    const result = await runCollection({ config, plan, metadata: {}, saveReport: async () => {}, audit: url => { visited.push(url); return audit(url); } });
    assert.equal(result.routes.every(route => route.successCount === 1), true);
    assert.equal(visited.length, plan.routes.length);
    for (const [index, address] of visited.entries()) {
      const url = new URL(address);
      assert.equal(url.origin, config.environments[environment].origin);
      if (plan.routes[index].id === 'landing') assert.equal(url.pathname, '/');
      else assert.ok(url.pathname.startsWith('/en/'), address);
    }
    assert.equal(new URL(visited.find(url => url.includes('/video-create/'))).searchParams.get('mode'), 'text');
    assert.equal(plan.routes.some(route => route.id === 'ai-ads-en'), environment === 'staging');
  });
}

test('English Lighthouse batches start a separate series while retaining Chinese history', async () => {
  const legacy = structuredClone(config);
  for (const route of legacy.routes) if (route.id !== 'ai-ads-en') route.path = route.id === 'landing' ? '/zh/' : route.path.replace('/en/', '/zh/');
  const batches = [];
  for (const [index, settings] of [legacy, config].entries()) {
    const plan = selectPlan(settings, { routes: 'landing', runs: 1 });
    const comparisonKey = hash({ profile: plan.profile, routes: settings.routes, lighthouseVersion: '13.4.1', chromeVersion: settings.chromeVersion, platform: 'linux', runner: 'ubuntu-24.04-github-hosted' });
    batches.push(await runCollection({ config: settings, plan, audit, saveReport: async () => {}, metadata: { id: `batch-${index}`, generatedAt: `2026-11-${15 + index}T01:00:00Z`, comparisonKey } }));
  }
  assert.notEqual(batches[0].comparisonKey, batches[1].comparisonKey);
  assert.equal(comparableBaseline([batches[0]], batches[1], 'landing'), null);
  assert.deepEqual(seriesFor(batches, 'production', 'landing', 'performance', 0).map(point => point.id), ['batch-1']);
  assert.equal(batches[0].routes[0].path, '/zh/');
});

for (const environment of ['production', 'staging']) for (const device of ['desktop', 'mobile']) {
  test(`${environment}/${device} separates the canonical homepage from existing alias history`, async () => {
    const legacy = structuredClone(config);
    legacy.routes.find(route => route.id === 'landing').path = '/en/';
    const batches = [];
    for (const [index, settings] of [legacy, config].entries()) {
      const plan = selectPlan(settings, { environment, device, routes: 'landing', runs: 3 });
      const comparisonKey = hash({ profile: plan.profile, routes: settings.routes });
      batches.push(await runCollection({ config: settings, plan, audit, saveReport: async () => {}, metadata: { id: `homepage-${index}`, generatedAt: `2026-11-${16 + index}T01:00:00Z`, comparisonKey } }));
    }
    const oldBytes = JSON.stringify(batches[0]);
    assert.equal(batches[0].routes[0].path, '/en/');
    assert.equal(batches[1].routes[0].path, '/');
    assert.equal(batches[1].routes[0].successCount, 3);
    assert.equal(batches[1].routes[0].samples.every(sample => sample.finalUrl === `${config.environments[environment].origin}/`), true);
    assert.notEqual(batches[0].comparisonKey, batches[1].comparisonKey);
    assert.equal(comparableBaseline([batches[0]], batches[1], 'landing'), null);
    assert.deepEqual(seriesFor(batches, environment, 'landing', 'seo', 0, Date.now(), device).map(point => point.id), ['homepage-1']);
    assert.equal(JSON.stringify(batches[0]), oldBytes);
  });
}

test('the isolated English editor URL starts a new benchmark comparison series', () => {
  validateEditorConfig(editorConfig);
  const url = new URL(editorConfig.path, config.environments.production.origin);
  assert.equal(url.pathname, '/en/editor/');
  assert.equal(url.searchParams.get('benchmark'), '1');
  const legacy = { ...editorConfig, path: '/zh/editor/?benchmark=1' };
  const summary = summarizeEditor([{ metrics: { exportRtf: 0.5 } }], 1, editorConfig);
  const batches = [legacy, editorConfig].map((settings, index) => ({
    environment: 'production', generatedAt: `2026-11-${15 + index}T01:00:00Z`, runsPerBatch: 1,
    comparisonKey: hash({ config: settings, versions: { chrome: config.chromeVersion, engines: ['webcodecs'] } }), summary,
  }));
  assert.notEqual(batches[0].comparisonKey, batches[1].comparisonKey);
  assert.equal(editorSeries(batches, 'production', 'exportRtf', 0).length, 1);
});
