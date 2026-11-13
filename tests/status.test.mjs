import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { routeStates, batchStates, metricStatus } from '../web/budgets.mjs';
import { renderStatusGroups, renderGroupState, issueText, formatIssueValue } from '../web/status.mjs';
import { seriesFor } from '../web/model.mjs';

const config = JSON.parse(await fs.readFile(new URL('../monitor.config.json', import.meta.url), 'utf8'));
const metrics = { performance: 100, accessibility: 100, bestPractices: 100, seo: 100, lcpMs: 821.2709, cls: 0.00061127, tbtMs: 31 };
const route = (values = {}, overrides = {}) => ({ id: 'landing', labelKey: 'landing', metrics: { ...metrics, ...values }, successCount: 3, expectedCount: 3, status: 'critical', ...overrides });
const summary = (routes, overrides = {}) => ({ id: '100-1-production', environment: 'production', comparisonKey: 'same-tools', runsPerRoute: 3, generatedAt: '2026-11-11T06:45:16.272Z', targets: config.targets, critical: config.critical, routes, ...overrides });

test('homepage quality reflects accessibility without a best-practices penalty', () => {
  const states = routeStates(route({ accessibility: 96, bestPractices: 77 }), config);
  assert.equal(states.performance.status, 'pass');
  assert.deepEqual(states.performance.issues, []);
  assert.equal(states.quality.status, 'warning');
  assert.deepEqual(states.quality.issues.map(issue => [issue.key, issue.value, issue.target, issue.critical, issue.status]), [
    ['accessibility', 96, 100, 90, 'warning'],
  ]);
});

test('low or missing best-practices scores and legacy budgets cannot affect current or historical states', () => {
  const legacyBudgets = { targets: { ...config.targets, bestPractices: 95 }, critical: { ...config.critical, bestPractices: 85 } };
  for (const value of [0, 77, null, undefined]) {
    const entry = route({ bestPractices: value });
    const historical = summary([entry], legacyBudgets);
    const original = structuredClone(historical);
    for (const budgets of [config, legacyBudgets]) {
      const states = routeStates(entry, budgets);
      assert.equal(states.performance.status, 'pass');
      assert.equal(states.quality.status, 'pass');
      assert.deepEqual(states.quality.issues, []);
    }
    assert.equal(batchStates(historical).quality.status, 'pass');
    assert.equal(seriesFor([historical], 'production', 'landing', 'performance', 0)[0].states.quality.status, 'pass');
    assert.deepEqual(historical, original);
  }
});

test('slow LCP affects performance without changing passing quality', () => {
  const states = routeStates(route({ lcpMs: 4500 }), config);
  assert.equal(states.performance.status, 'critical');
  assert.equal(states.quality.status, 'pass');
  assert.deepEqual(states.performance.issues.map(issue => issue.key), ['lcpMs']);
});

test('all performance metrics and quality categories participate only in their own group', () => {
  for (const [key, value, group] of [['performance', 60, 'performance'], ['lcpMs', 5000, 'performance'], ['cls', .3, 'performance'], ['tbtMs', 700, 'performance'], ['accessibility', 80, 'quality'], ['seo', 70, 'quality']]) {
    const states = routeStates(route({ [key]: value }), config);
    assert.equal(states[group].status, 'critical', key);
    assert.equal(states[group === 'performance' ? 'quality' : 'performance'].status, 'pass', key);
  }
});

test('target and critical equality retain the inclusive budget boundaries', () => {
  assert.equal(metricStatus('performance', 90, config), 'pass');
  assert.equal(metricStatus('performance', 70, config), 'warning');
  assert.equal(metricStatus('lcpMs', 2500, config), 'pass');
  assert.equal(metricStatus('lcpMs', 4000, config), 'warning');
  assert.equal(metricStatus('seo', 95, config), 'pass');
  assert.equal(metricStatus('seo', 85, config), 'warning');
});

test('unmeasured pages remain unknown and partial samples never appear on target', () => {
  const unmeasured = routeStates(undefined, config);
  assert.equal(unmeasured.performance.status, 'unknown');
  assert.equal(unmeasured.quality.status, 'unknown');
  const incomplete = routeStates(route({}, { successCount: 1 }), config);
  for (const state of Object.values(incomplete)) {
    assert.equal(state.status, 'failed');
    assert.equal(issueText(state.issues[0], 'zh'), '有效样本: 1/3');
  }
});

test('missing quality metrics or budgets do not mark passing performance as failed', () => {
  const missing = routeStates(route({ seo: null }), config);
  assert.equal(missing.performance.status, 'pass');
  assert.equal(missing.quality.status, 'failed');
  assert.equal(issueText(missing.quality.issues[0], 'zh'), '缺少有效指标或阈值: SEO');
  const budgets = structuredClone(config); delete budgets.critical.seo;
  assert.equal(routeStates(route(), budgets).quality.status, 'failed');
});

test('batch history aggregates independent states and retains page-specific causes', () => {
  const states = batchStates(summary([route({ accessibility: 80, bestPractices: 77 }), route({ lcpMs: 4500 }, { id: 'home', labelKey: 'home' })]), config);
  assert.equal(states.performance.status, 'critical');
  assert.equal(states.quality.status, 'critical');
  assert.equal(states.performance.issues[0].pageLabelKey, 'home');
  assert.equal(states.quality.issues[0].pageLabelKey, 'landing');
});

test('historical status uses the recorded budgets instead of current targets', () => {
  const historical = summary([route({ lcpMs: 2700 })], { targets: { ...config.targets, lcpMs: 3000 }, critical: { ...config.critical, lcpMs: 5000 } });
  assert.equal(batchStates(historical, config).performance.status, 'pass');
  assert.equal(routeStates(historical.routes[0], config).performance.status, 'warning');
  const points = seriesFor([historical], 'production', 'landing', 'performance', 0);
  assert.equal(points[0].states.performance.status, 'pass');
  assert.equal(points[0].states.quality.status, 'pass');
});

test('status rendering names both scopes and gives the real value, target and critical threshold', () => {
  const states = routeStates(route({ accessibility: 96, bestPractices: 77, seo: 70 }), config);
  const html = renderStatusGroups(states, 'zh');
  assert.match(html, /性能状态/); assert.match(html, /页面质量状态/);
  assert.match(renderGroupState(states.performance, 'performance', 'zh'), /class="status pass"/);
  assert.match(html, /SEO 70 分 · 目标 ≥ 95 分 · 严重阈值 &lt; 85 分/);
  assert.doesNotMatch(html, /最佳实践|bestPractices/);
  assert.match(html, /无障碍 96 分 · 目标 ≥ 100 分/);
  assert.equal(states.quality.issues.filter(issue => issue.status === 'critical').length, 1);
});

test('upper-bound performance issues show units and the correct comparison direction', () => {
  const states = routeStates(route({ lcpMs: 4500, cls: .3 }), config);
  assert.match(issueText(states.performance.issues[0], 'en'), /LCP 4,500 ms · Target ≤ 2,500 ms · Critical threshold > 4,000 ms/);
  assert.match(issueText(states.performance.issues[1], 'zh'), /CLS 0.3 · 目标 ≤ 0.1 · 严重阈值 > 0.25/);
});

test('values just outside a target do not round to a misleading equality', () => {
  assert.notEqual(formatIssueValue(.100000000001, .1, 'cls', 'en'), '0.1');
  assert.notEqual(formatIssueValue(2500.001, 2500, 'lcpMs', 'en'), '2,500');
});

test('batch details remain keyboard-accessible, localized and escaped', () => {
  const states = batchStates(summary([route({ seo: 77 })]), config);
  const html = renderStatusGroups(states, 'en', { collapse: true });
  assert.match(html, /<details/); assert.match(html, /<summary>Unmet checks \(1\)<\/summary>/);
  assert.match(html, /Landing page/); assert.match(html, /Page quality status/);
  const unsafe = { status: 'failed', issues: [{ kind: 'missing', key: '<img>', pageLabelKey: '<script>', status: 'failed' }] };
  const escaped = renderGroupState(unsafe, 'quality', 'en');
  assert.doesNotMatch(escaped, /<script>|<img>/); assert.match(escaped, /&lt;script&gt;/);
});

test('batch records without stored thresholds remain incomplete rather than borrowing current budgets', () => {
  const historical = summary([route()], { targets: undefined, critical: undefined });
  assert.equal(batchStates(historical).performance.status, 'failed');
  assert.equal(batchStates(historical).quality.status, 'failed');
});
