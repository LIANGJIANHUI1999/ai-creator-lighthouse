import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolveSettings as resolveOriginal } from 'lighthouse/core/config/config-helpers.js';
import { resolveSettings as resolveMobile } from 'lighthouse-mobile/core/config/config-helpers.js';
import { loadLighthouseEngine } from '../scripts/lighthouse-engine.mjs';
import { comparableBaseline, hash, runCollection, selectPlan } from '../scripts/lib.mjs';
import { mergeHistory } from '../scripts/archive.mjs';
import { seriesFor } from '../web/model.mjs';

const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));

test('desktop keeps its original engine while mobile loads the pinned upstream fix', async () => {
  const desktop = await loadLighthouseEngine('desktop');
  const mobile = await loadLighthouseEngine('mobile');
  assert.equal(desktop.version, '13.4.1');
  assert.equal(mobile.version, '13.6.0');
  assert.equal(desktop.audit, (await import('lighthouse')).default);
  assert.equal(mobile.audit, (await import('lighthouse-mobile')).default);
  for (const device of ['unknown', '__proto__', '../lighthouse', 'toString'])
    await assert.rejects(loadLighthouseEngine(device), /Unsupported Lighthouse device/);
});

test('the mobile engine preserves every explicitly configured measurement condition', () => {
  const before = JSON.stringify(config);
  const { id, ...flags } = selectPlan(config, { device: 'mobile' }).profile;
  const original = resolveOriginal({}, flags);
  const updated = resolveMobile({}, flags);
  for (const name of Object.keys(flags)) assert.deepEqual(updated[name], original[name], name);
  assert.equal(updated.formFactor, 'mobile');
  assert.equal(updated.screenEmulation.width, 412);
  assert.equal(updated.screenEmulation.height, 823);
  assert.equal(updated.screenEmulation.deviceScaleFactor, 1.75);
  assert.equal(updated.throttling.cpuSlowdownMultiplier, 4);
  assert.equal(updated.throttlingMethod, 'simulate');
  assert.equal(config.targets.performance, 90);
  assert.equal(config.targets.lcpMs, 2500);
  assert.equal(config.targets.tbtMs, 200);
  assert.equal(config.targets.cls, 0.1);
  assert.equal(JSON.stringify(config), before);
});

test('version correction retains old history and starts a separate mobile comparison series', async () => {
  const plan = selectPlan(config, { environment: 'staging', device: 'mobile', routes: 'home', runs: 1 });
  const batches = [];
  for (const [index, lighthouseVersion] of ['13.4.1', '13.6.0'].entries()) {
    const comparisonKey = hash({ profile: plan.profile, routes: config.routes, lighthouseVersion, chromeVersion: config.chromeVersion, platform: 'linux', runner: 'ubuntu-24.04-github-hosted' });
    batches.push(await runCollection({
      config, plan,
      metadata: { id: `engine-${index}`, generatedAt: `2026-11-${16 + index}T00:00:00Z`, comparisonKey, versions: { lighthouse: lighthouseVersion } },
      saveReport: async () => {},
      audit: async url => ({ lhr: {
        requestedUrl: url, finalDisplayedUrl: url,
        categories: Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo'].map(id => [id, { score: 1 }])),
        audits: { 'http-status-code': { score: 1 }, 'largest-contentful-paint': { numericValue: 500 }, 'cumulative-layout-shift': { numericValue: 0 }, 'total-blocking-time': { numericValue: 0 } },
      } }),
    }));
  }
  const original = JSON.stringify(batches[0]);
  const history = mergeHistory([batches[0]], [batches[1]]);
  assert.equal(history.length, 2);
  assert.equal(JSON.stringify(history[0]), original);
  assert.notEqual(batches[0].comparisonKey, batches[1].comparisonKey);
  assert.equal(comparableBaseline(history.slice(0, 1), batches[1], 'home'), null);
  assert.deepEqual(seriesFor(history, 'staging', 'home', 'performance', 0, Date.now(), 'mobile').map(point => point.id), ['engine-1']);
});
