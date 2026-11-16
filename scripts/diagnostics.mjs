import fs from 'node:fs/promises';
import path from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);
export const diagnosticKind = 'cpu-profile-v1';
export function diagnosticMode(value) {
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('LIGHTHOUSE_DIAGNOSTICS must be 0 or 1');
}
export function validateDiagnosticTarget(enabled, { environment, device }) {
  if (enabled && (environment !== 'staging' || device !== 'mobile'))
    throw new Error('Diagnostics require staging mobile; regular collection is unchanged');
}
export function diagnosticSettings(enabled) {
  return enabled ? { additionalTraceCategories: ['disabled-by-default-v8.cpu_profiler'] } : {};
}

/** Diagnostic evidence is compressed after the audit, never a replacement score. */
export async function saveDiagnosticAssets(directory, name, artifacts) {
  if (!/^[a-z][a-z0-9-]*-run-\d+-attempt-\d+$/.test(name)) throw new Error('Invalid diagnostic name');
  if (!Array.isArray(artifacts?.Trace?.traceEvents) || !Array.isArray(artifacts?.DevtoolsLog))
    throw new Error('Diagnostic trace or network log is unavailable');
  const files = { trace: `${name}.trace.json.gz`, network: `${name}.devtoolslog.json.gz` };
  await fs.mkdir(directory, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(directory, files.trace), await compress(JSON.stringify(artifacts.Trace))),
    fs.writeFile(path.join(directory, files.network), await compress(JSON.stringify(artifacts.DevtoolsLog))),
  ]);
  return files;
}
