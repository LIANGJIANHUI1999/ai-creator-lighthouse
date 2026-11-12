import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { saveEditorExport } from '../scripts/editor-evidence.mjs';

const mp4 = Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109]);
const data = `data:video/mp4;base64,${mp4.toString('base64')}`;
async function destination(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-export-evidence-'));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  return path.join(directory, 'run-1-export.mp4');
}
test('preserves the exact measured MP4 as a downloadable binary', async t => {
  const file = await destination(t);
  await saveEditorExport({evaluate:async () => data}, file, mp4.length);
  assert.deepEqual(await fs.readFile(file), mp4);
});
test('rejects missing, mismatched or malformed evidence without writing a file', async t => {
  const file = await destination(t);
  for (const [value, size] of [[null,mp4.length],[data,mp4.length+1],['data:video/webm;base64,AAAA',3],['data:video/mp4;base64,AAAA',3]]) {
    await assert.rejects(saveEditorExport({evaluate:async () => value}, file, size));
    await assert.rejects(fs.access(file));
  }
});
test('surfaces file read and write failures', async t => {
  const file = await destination(t);
  await assert.rejects(saveEditorExport({evaluate:async () => {throw new Error('read failure');}},file,mp4.length),/read failure/);
  await assert.rejects(saveEditorExport({evaluate:async () => data},path.join(file,'missing.mp4'),mp4.length));
});
