import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Run the actual app module against a minimal document and a mocked data response.
// This checks status wiring and locale/environment updates without browser automation.
test('dashboard shows independent statuses in the heading, overview, sidebar, trend data and history', async t => {
  const config = JSON.parse(await fs.readFile(new URL('../monitor.config.json', import.meta.url), 'utf8'));
  const metrics = { performance: 100, lcpMs: 821, cls: .001, tbtMs: 31, accessibility: 96, bestPractices: 77, seo: 100 };
  const makeSummary = (environment, values) => ({
    id: `100-1-${environment}`, environment, origin: config.environments[environment].origin,
    generatedAt: new Date().toISOString(), comparisonKey: 'same-settings', runsPerRoute: 3, versions: {}, targets: config.targets, critical: config.critical,
    routes: [{ id: 'landing', labelKey: 'landing', metrics: values, successCount: 3, expectedCount: 3, status: 'critical', regressions: [], ranges: {} }],
  });
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', hidden: false, setAttribute() {}, removeAttribute() {} });
    return elements.get(id);
  };
  let click;
  const originals = Object.fromEntries(['document', 'location', 'history', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  globalThis.document = { documentElement: {}, getElementById: element, querySelectorAll: () => [], addEventListener: (event, listener) => { if (event === 'click') click = listener; } };
  globalThis.location = { search: '?env=production&page=landing&lang=zh', hash: '' };
  globalThis.history = { replaceState() {} };
  const payload = { schemaVersion: 1, config, reports: {}, summaries: [makeSummary('production', metrics), makeSummary('staging', { ...metrics, accessibility: 100, bestPractices: 100, lcpMs: 4500 })] };
  globalThis.fetch = async url => {
    assert.equal(url, './data.json');
    return { ok: true, json: async () => payload };
  };
  await import('../web/app.mjs');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(element('load-status').hidden, true);
  assert.doesNotMatch(element('routes').innerHTML, /ai-ads-en/);
  const heading = element('selected-status').innerHTML;
  assert.match(heading, /data-status-group="performance"[^]*?class="status pass"/);
  assert.match(heading, /data-status-group="quality"[^]*?class="status critical"/);
  assert.match(heading, /最佳实践 77 分 · 目标 ≥ 95 分/);
  assert.match(element('overview').innerHTML, /<th>性能状态<\/th><th>页面质量状态<\/th>/);
  assert.match(element('overview').innerHTML, /无障碍 96 分 · 目标 ≥ 100 分/);
  assert.match(element('routes').innerHTML, /class="route-score pass">100/);
  assert.match(element('sample-data').innerHTML, /页面质量状态/);
  assert.match(element('sample-data').innerHTML, /最佳实践 77 分/);
  assert.match(element('history-list').innerHTML, /页面质量状态/);
  assert.match(element('history-list').innerHTML, /官网首页<\/strong> · 最佳实践 77 分/);

  const press = values => click({ target: { closest: () => ({ dataset: {}, ...values }) } });
  press({ id: 'language' });
  assert.match(element('selected-status').innerHTML, /Performance status/);
  assert.match(element('overview').innerHTML, /Best practices 77 points · Target ≥ 95 points/);
  press({ dataset: { env: 'staging' } });
  assert.match(element('routes').innerHTML, /ai-ads-en/);
  assert.match(element('overview').innerHTML, /AI ads \(EN\)/);
  press({ dataset: { route: 'ai-ads-en' } });
  assert.equal(element('site-link').href, 'https://vidmaeditor-ios.web.app/en/ai-ads/');
  press({ dataset: { env: 'production' } });
  assert.equal(element('selected-page').textContent, 'Landing page');
  assert.doesNotMatch(element('routes').innerHTML, /ai-ads-en/);
  press({ dataset: { env: 'staging' } });
  const changed = element('selected-status').innerHTML;
  assert.match(changed, /data-status-group="performance"[^]*?class="status critical"/);
  assert.match(changed, /data-status-group="quality"[^]*?class="status pass"/);
  assert.match(changed, /LCP 4,500 ms · Target ≤ 2,500 ms/);
  assert.doesNotMatch(changed, /Best practices 77/);
  delete payload.summaries[0].targets; delete payload.summaries[0].critical;
  press({ dataset: { env: 'production' } });
  assert.match(element('selected-status').innerHTML, /Missing metric or budget/);
  assert.equal(element('load-status').hidden, true);
  assert.doesNotMatch(element('chart').innerHTML, /NaN/);
});
