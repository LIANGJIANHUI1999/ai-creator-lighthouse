import fs from 'node:fs/promises';

// Capture after all timed operations and long-task observations have ended.
export async function saveEditorExport(page, destination, expectedBytes) {
  const data = await page.evaluate(async () => {
    const blob = window.__editorBench?.exportBlob;
    if (!(blob instanceof Blob) || blob.size <= 0) return null;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read exported MP4'));
      reader.readAsDataURL(blob);
    });
  });
  const prefix = 'data:video/mp4;base64,';
  if (typeof data !== 'string' || !data.startsWith(prefix)) throw new Error('Exported MP4 evidence unavailable');
  const bytes = Buffer.from(data.slice(prefix.length), 'base64');
  if (bytes.length !== expectedBytes || bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Exported MP4 evidence does not match measured output');
  await fs.writeFile(destination, bytes);
}
