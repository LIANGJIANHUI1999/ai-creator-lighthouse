import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packages = { desktop: 'lighthouse', mobile: 'lighthouse-mobile' };

/** Mobile uses the upstream H2 and same-frame text LCP fixes. The desktop
 * engine and every device's measurement settings remain independently pinned. */
export async function loadLighthouseEngine(device) {
  if (!Object.hasOwn(packages, device)) throw new Error('Unsupported Lighthouse device');
  const packageName = packages[device];
  const [{ default: audit }, metadata] = await Promise.all([
    import(packageName),
    fs.readFile(require.resolve(`${packageName}/package.json`), 'utf8').then(JSON.parse),
  ]);
  return { audit, version: metadata.version, packageName };
}
