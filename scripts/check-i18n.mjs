import fs from 'node:fs/promises';
import { messages } from '../web/i18n.mjs';
const source = Object.keys(messages.zh).sort();
for (const [locale, values] of Object.entries(messages)) {
  if (JSON.stringify(Object.keys(values).sort()) !== JSON.stringify(source)) throw new Error(`Locale keys differ: ${locale}`);
  if (Object.values(values).some(value => typeof value !== 'string' || !value.trim())) throw new Error(`Empty translation: ${locale}`);
}
const html = await fs.readFile('web/index.html', 'utf8');
for (const match of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) if (!Object.hasOwn(messages.zh, match[1])) throw new Error(`Unknown translation: ${match[1]}`);
const config = JSON.parse(await fs.readFile('monitor.config.json', 'utf8'));
for (const item of [...config.routes, ...Object.values(config.environments)]) if (!Object.hasOwn(messages.zh, item.labelKey)) throw new Error(`Unknown label: ${item.labelKey}`);
console.log(`i18n: ${source.length} keys × ${Object.keys(messages).length} locales verified`);
