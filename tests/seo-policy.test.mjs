import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from '../scripts/build.mjs';
import { assessSeoPolicy, summarizeSeoPolicy } from '../web/seo-policy.mjs';
import { runCollection, selectPlan, routeStatus, validateConfig } from '../scripts/lib.mjs';
import { routeStates, batchStates } from '../web/budgets.mjs';
import { renderStatusGroups } from '../web/status.mjs';

const config = JSON.parse(await fs.readFile(new URL('../monitor.config.json', import.meta.url), 'utf8'));
const metrics = { performance: 99, accessibility: 100, bestPractices: 100, seo: 66, lcpMs: 900, cls: 0, tbtMs: 20 };
function lhr(url = 'https://vidmaeditor-ios.web.app/zh/editor/') {
  return {
    requestedUrl: url, finalDisplayedUrl: url,
    categories: { performance: { score: .99 }, accessibility: { score: 1 }, 'best-practices': { score: 1 }, seo: { score: .66, auditRefs: [{ id: 'is-crawlable', weight: 4 }, { id: 'document-title', weight: 1 }, { id: 'meta-description', weight: 1 }] } },
    audits: {
      'http-status-code': { score: 1 }, 'largest-contentful-paint': { numericValue: 900 }, 'cumulative-layout-shift': { numericValue: 0 }, 'total-blocking-time': { numericValue: 20 },
      'is-crawlable': { score: 0, details: { items: [{ source: { type: 'node', snippet: '<meta name="robots" content="noindex, nofollow">' } }] } },
      'document-title': { score: 1 }, 'meta-description': { score: 1 },
    },
  };
}
const assessment = report => assessSeoPolicy(report, 'noindex');
function route(reports = [lhr(), lhr(), lhr()]) {
  return { id: 'editor', labelKey: 'editor', seoPolicy: 'noindex', metrics: { ...metrics }, successCount: reports.length, expectedCount: 3, seoAssessment: summarizeSeoPolicy(reports.map(report => ({ seoAssessment: assessment(report) })), 'noindex', 3) };
}

test('explicit noindex verifies the directive and scores other SEO audits without changing raw data', () => {
  const report = lhr();
  const result = assessment(report);
  assert.equal(result.complete, true);
  assert.equal(result.noindexConfirmed, true);
  assert.equal(result.otherScore, 100);
  assert.equal(report.categories.seo.score, .66);
  assert.deepEqual(result.failedAudits, []);
  assert.equal(assessSeoPolicy(report, undefined), null);
});
test('robots blocking alone, unrelated markup, lookalike directives and indexable pages do not satisfy noindex', () => {
  for (const source of [{ type: 'source-location', url: 'https://example.test/robots.txt' }, '<div name="robots" content="noindex">', '<meta name="robots" content="x-noindex">', '<meta name="robots" content="index, follow">']) {
    const report = lhr(); report.audits['is-crawlable'].details.items = [{ source }];
    assert.equal(assessment(report).noindexConfirmed, false);
  }
  const indexed = lhr(); indexed.audits['is-crawlable'].score = 1;
  assert.equal(assessment(indexed).noindexConfirmed, false);
  const header = lhr(); header.audits['is-crawlable'].details.items = [{ source: 'X-Robots-Tag: noindex, nofollow' }];
  assert.equal(assessment(header).noindexConfirmed, true);
});
test('other SEO failures remain visible and the worst repeat participates in unchanged budgets', () => {
  const bad = lhr(); bad.audits['meta-description'].score = 0;
  const entry = route([lhr(), bad, lhr()]);
  assert.equal(entry.metrics.seo, 66);
  assert.equal(entry.seoAssessment.otherScore, 50);
  assert.deepEqual(entry.seoAssessment.failedAudits, ['meta-description']);
  const state = routeStates(entry, config);
  assert.equal(state.performance.status, 'pass');
  assert.equal(state.quality.status, 'critical');
  assert.equal(state.quality.issues[0].labelKey, 'seoOtherAudits');
});
test('missing audits or missing/incomplete policy evidence cannot produce a passing quality state', () => {
  const missing = lhr(); delete missing.audits['meta-description'];
  assert.equal(assessment(missing).complete, false);
  for (const entry of [route([lhr()]), route([lhr(), missing, lhr()]), { ...route(), seoAssessment: undefined }, { ...route(), seoAssessment: { ...route().seoAssessment, sampleCount: 1 } }]) {
    assert.equal(routeStates(entry, config).quality.status, 'failed');
  }
  const rawMissing = route(); rawMissing.metrics.seo = null;
  assert.equal(routeStates(rawMissing, config).quality.status, 'failed');
});
test('a removed noindex directive is a policy failure even with a raw SEO score of 100', () => {
  const indexed = lhr(); indexed.audits['is-crawlable'] = { score: 1 };
  const entry = route([lhr(), indexed, lhr()]); entry.metrics.seo = 100;
  assert.equal(routeStates(entry, config).quality.status, 'critical');
  assert.equal(routeStates(entry, config).quality.issues[0].kind, 'seoPolicyMismatch');
});
test('ordinary routes keep the raw SEO budget and historic noindex scores are not retroactively promoted', () => {
  const entry = route(); delete entry.seoPolicy;
  assert.equal(routeStates(entry, config).quality.status, 'critical');
  assert.equal(routeStatus(entry, config), 'critical');
});
test('policy status and batch history retain explanatory raw scores in both locales', () => {
  const entry = route();
  assert.equal(routeStatus(entry, config), 'pass');
  for (const locale of ['zh', 'en']) {
    const html = renderStatusGroups(routeStates(entry, config), locale);
    assert.match(html, /66/); assert.match(html, /100/);
    assert.match(html, locale === 'zh' ? /按预期禁止收录/ : /Intentionally not indexed/);
    assert.match(renderStatusGroups(batchStates({ ...config, routes: [entry] }), locale), /66/);
  }
});
test('config only permits an explicit supported policy', () => {
  assert.equal(config.routes.find(route => route.id === 'editor').seoPolicy, 'noindex');
  assert.equal(config.routes.find(route => route.id === 'tools').seoPolicy, 'noindex');
  const invalid = structuredClone(config); invalid.routes[0].seoPolicy = 'ignore-seo';
  assert.throws(() => validateConfig(invalid), /SEO policy/);
});
test('collection persists per-repeat directive evidence and retains the original Lighthouse score', async () => {
  const plan = selectPlan(config, { environment: 'staging', routes: 'editor', runs: 3 });
  const summary = await runCollection({ config, plan, metadata: { id: 'policy-test' }, audit: async url => ({ lhr: lhr(url) }), saveReport: async () => {} });
  const entry = summary.routes[0];
  assert.equal(entry.successCount, 3);
  assert.equal(entry.metrics.seo, 66);
  assert.equal(entry.seoAssessment.otherScore, 100);
  assert.equal(entry.seoAssessment.noindexConfirmed, true);
  assert.equal(entry.samples[0].seoAssessment.evidence.length, 1);
  assert.equal(entry.status, 'pass');
});

test('published dashboard data retains policy evidence and raw scores after compacting samples', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seo-policy-dashboard-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const summary = { ...config, id: '100-1-staging', environment: 'staging', generatedAt: '2026-11-12T02:00:00Z', routes: [route()] };
  await build({ config, history: [summary], webDirectory: new URL('../web/', import.meta.url), outputDirectory: directory });
  const data = JSON.parse(await fs.readFile(path.join(directory, 'data.json'), 'utf8'));
  const entry = data.summaries[0].routes[0];
  assert.equal(entry.metrics.seo, 66);
  assert.equal(entry.seoPolicy, 'noindex');
  assert.equal(entry.seoAssessment.noindexConfirmed, true);
  assert.equal(entry.seoAssessment.otherScore, 100);
});
