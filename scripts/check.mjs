import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { validateConfig } from './lib.mjs';
for (const directory of ['scripts', 'web', 'tests']) {
  for (const file of await fs.readdir(directory)) if (file.endsWith('.mjs')) execFileSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'pipe' });
}
validateConfig(JSON.parse(await fs.readFile('monitor.config.json', 'utf8')));
for (const file of await fs.readdir('.github/workflows')) {
  const document = parseDocument(await fs.readFile(`.github/workflows/${file}`, 'utf8'), { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map(error => error.message).join('\n'));
}
for (const file of ['web/index.html', 'web/app.mjs']) {
  if (/<\/?(?:select|option|optgroup|datalist)(?:\s|>)/i.test(await fs.readFile(file, 'utf8'))) throw new Error('Native dropdowns are not allowed');
}
console.log('JavaScript syntax, workflow YAML and monitoring configuration verified');
