import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { diagnosticMode, diagnosticSettings, saveDiagnosticAssets, validateDiagnosticTarget } from '../scripts/diagnostics.mjs';
import { mergeHistory } from '../scripts/archive.mjs';
import { hash } from '../scripts/lib.mjs';

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lighthouse-diagnostics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('default collection retains its exact settings and comparison identity', () => {
  assert.equal(diagnosticMode(undefined), false);
  assert.equal(diagnosticMode('0'), false);
  assert.equal(diagnosticMode('1'), true);
  assert.throws(() => diagnosticMode('true'), /must be 0 or 1/);
  const profile = { formFactor: 'mobile', throttling: { cpuSlowdownMultiplier: 4 } };
  assert.deepEqual({ ...profile, ...diagnosticSettings(false) }, profile);
  const base = { profile, version: '13.4.1' };
  assert.equal(hash({ ...base, ...(false ? { diagnostic: 'cpu-profile-v1' } : {}) }), hash(base));
  assert.deepEqual(diagnosticSettings(true), { additionalTraceCategories: ['disabled-by-default-v8.cpu_profiler'] });
  assert.doesNotThrow(() => validateDiagnosticTarget(false, { environment: 'production', device: 'desktop' }));
  assert.doesNotThrow(() => validateDiagnosticTarget(true, { environment: 'staging', device: 'mobile' }));
  for (const plan of [{ environment: 'production', device: 'mobile' }, { environment: 'staging', device: 'desktop' }])
    assert.throws(() => validateDiagnosticTarget(true, plan), /require staging mobile/);
});

test('diagnostic evidence round trips exactly in bounded filenames', async t => {
  const directory = await temporary(t);
  const trace = { traceEvents: [{ name: 'ProfileChunk', args: { data: { text: '原文 $1' } } }] };
  const log = [{ method: 'Network.requestWillBeSent', params: { request: { url: 'https://example.com/' } } }];
  const files = await saveDiagnosticAssets(directory, 'ai-ads-en-run-1-attempt-1', { Trace: trace, DevtoolsLog: log });
  assert.deepEqual(JSON.parse(gunzipSync(await fs.readFile(path.join(directory, files.trace)))), trace);
  assert.deepEqual(JSON.parse(gunzipSync(await fs.readFile(path.join(directory, files.network)))), log);
  for (const bad of ['../escape-run-1-attempt-1', 'home/run-1-attempt-1', 'home-run-1-attempt-1.json'])
    await assert.rejects(saveDiagnosticAssets(directory, bad, { Trace: trace, DevtoolsLog: log }), /Invalid diagnostic name/);
  await assert.rejects(saveDiagnosticAssets(directory, 'home-run-1-attempt-1', { Trace: trace }), /unavailable/);
  await assert.rejects(saveDiagnosticAssets(directory, 'home-run-1-attempt-1', { Trace: {}, DevtoolsLog: log }), /unavailable/);
});

test('diagnostic reports cannot enter normal history even if publication is misconfigured', () => {
  const normal = { id: 'normal', schemaVersion: 1, generatedAt: '2026-11-17T00:00:00Z', routes: [] };
  assert.equal(mergeHistory([], [normal]).length, 1);
  assert.throws(() => mergeHistory([normal], [{ ...normal, id: 'diagnostic', diagnostic: true }]), /must not enter metric history/);
  assert.throws(() => mergeHistory([normal], [{ ...normal, id: 'diagnostic', diagnostic: 'true' }]), /must not enter metric history/);
});

test('workflow validates a diagnostic request and skips all publication and health consumers', async t => {
  const flow = parse(await fs.readFile('.github/workflows/monitor.yml', 'utf8'));
  assert.equal(flow.on.workflow_dispatch.inputs.diagnostics.default, false);
  for (const job of ['publish', 'collection-health']) assert.match(flow.jobs[job].if, /!inputs\.diagnostics/);
  assert.equal(flow.jobs.deploy.needs.includes('quality-gate'), true);
  assert.equal(flow.jobs.deploy.needs.includes('publish'), true);
  const step = flow.jobs['quality-gate'].steps.find(step => step.id === 'plan');
  const directory = await temporary(t);
  const env = { ...process.env, DIAGNOSTICS: '1', TARGET: 'staging', DEVICE: 'mobile', SUITE: 'lighthouse', ROUTES: 'home', RUNS: '1', GITHUB_OUTPUT: path.join(directory, 'valid.txt') };
  execFileSync('bash', ['-c', step.run], { env, stdio: 'pipe' });
  const output = await fs.readFile(env.GITHUB_OUTPUT, 'utf8');
  assert.match(output, /"environment":"staging","device":"mobile"/);
  for (const override of [{ TARGET: 'production' }, { DEVICE: 'all' }, { SUITE: 'editor' }])
    assert.throws(() => execFileSync('bash', ['-c', step.run], { env: { ...env, ...override }, stdio: 'pipe' }), /Diagnostics require/);
});
