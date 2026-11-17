import fs from 'node:fs/promises';
export const cpuTraceFlags = enabled => enabled ? { additionalTraceCategories: 'disabled-by-default-v8.cpu_profiler' } : {};
export async function saveCpuTrace(result, filename) {
  const trace = result.artifacts?.traces?.defaultPass;
  if (!trace?.traceEvents?.length) throw new Error('CPU diagnostic trace is missing');
  await fs.writeFile(filename, JSON.stringify(trace));
}
