import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cpuTraceFlags, saveCpuTrace } from '../scripts/cpu-trace.mjs';
test('diagnostic sampling is opt-in and does not replace metric settings', () => {
 assert.deepEqual(cpuTraceFlags(false), {});
 assert.deepEqual(cpuTraceFlags(true), {additionalTraceCategories:'disabled-by-default-v8.cpu_profiler'});
});
test('preserves raw CPU trace evidence and rejects missing evidence', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'lh-cpu-trace-'));
 try {
  const trace = {traceEvents:[{name:'ProfileChunk',args:{data:{cpuProfile:{nodes:[]}}}}]};
  const file = path.join(root,'trace.json');
  await saveCpuTrace({artifacts:{Trace:trace}},file);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),trace);
  await assert.rejects(saveCpuTrace({},file), /missing/);
  await assert.rejects(saveCpuTrace({artifacts:{Trace:{traceEvents:[]}}},file), /missing/);
  await assert.rejects(saveCpuTrace({artifacts:{Trace:{traceEvents:'invalid'}}},file), /missing/);
 } finally {await fs.rm(root,{recursive:true,force:true})}
});
