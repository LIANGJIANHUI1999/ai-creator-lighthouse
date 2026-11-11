// Page adapter: Puppeteer in Linux CI; ordinary exports can also be inspected with ego-browser.
export async function runEditorScenario(page, { url, fixturePath, config, timeout = 30000 }) {
  const metrics = Object.fromEntries(Object.keys(config.targets).map(key => [key, null]));
  const failures = [], detail = { url, stages: [] };
  const attempt = async (name, operation) => {
    const startedAt = Date.now();
    try { const value = await operation(); detail.stages.push({ name, elapsedMs: Date.now() - startedAt, status: 'success' }); return value; }
    catch (error) { failures.push({ stage: name, message: String(error.message).slice(0, 1000) }); detail.stages.push({ name, elapsedMs: Date.now() - startedAt, status: 'failed' }); return null; }
  };
  const loaded = await attempt('navigation', async () => {
    const start = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector('[data-editor-ready="true"]', { timeout });
    const actual = new URL(page.url()), requested = new URL(url);
    if (actual.origin !== requested.origin || actual.pathname !== requested.pathname || actual.searchParams.get('benchmark') !== '1') throw new Error('Unexpected editor URL');
    metrics.editorReadyMs = Date.now() - start;
    await page.evaluate(() => {
      window.__editorBench = { longTasks: [], exportBlob: null, exportName: null };
      try {
        const observer = new PerformanceObserver(list => window.__editorBench.longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration }))));
        observer.observe({ type: 'longtask', buffered: false });
        window.__editorBench.longTaskSupported = true;
      } catch { window.__editorBench.longTaskSupported = false; }
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = value => {
        const url = createObjectURL(value);
        if (window.__editorBench.exportArmed && value instanceof Blob && value.type.includes('mp4')) window.__editorBench.exportBlob = value;
        return url;
      };
    });
    return true;
  });
  if (!loaded) return { metrics, failures, detail };
  const imported = await attempt('import', async () => {
    const input = await page.$('input[accept^="video/"]');
    if (!input) throw new Error('Video file input unavailable');
    const start = Date.now();
    await input.uploadFile(fixturePath);
    await page.waitForSelector('[data-editor-preview-ready="true"]', { timeout });
    const previewReadyMs = Date.now() - start;
    detail.source = await page.evaluate(() => {
      const video = [...document.querySelectorAll('video')].find(video => video.currentSrc && video.readyState >= 2);
      return video ? { width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 } : null;
    });
    if (!detail.source || Math.abs(detail.source.durationMs - config.fixture.durationMs) > 100) throw new Error('Imported fixture duration does not match');
    metrics.previewReadyMs = previewReadyMs;
    await attempt('filmstrip', async () => {
      await page.waitForSelector('[data-editor-filmstrip-ready="true"]', { timeout });
      metrics.filmstripReadyMs = Date.now() - start;
      return true;
    });
    return true;
  });
  if (imported) {
    await attempt('playback', async () => {
      await page.evaluate(() => {
        const video = [...document.querySelectorAll('video')].find(video => video.currentSrc && video.readyState >= 2);
        if (!video?.requestVideoFrameCallback || !video.getVideoPlaybackQuality) throw new Error('Frame timing APIs unavailable');
        const button = document.querySelector('button[aria-label="播放"]');
        if (!button) throw new Error('Play button unavailable');
        window.__editorBench.playResponseMs = null;
        window.__editorBench.beforeQuality = video.getVideoPlaybackQuality();
        window.__editorBench.playInitialTime = video.currentTime;
        button.addEventListener('pointerdown', () => {
          const start = performance.now();
          video.requestVideoFrameCallback(() => { window.__editorBench.playResponseMs = performance.now() - start; });
        }, { once: true, capture: true });
      });
      await page.click('button[aria-label="播放"]');
      await page.waitForFunction(() => Number.isFinite(window.__editorBench.playResponseMs), { timeout: 10000 });
      await page.waitForFunction(sampleMs => {
        const video = [...document.querySelectorAll('video')].find(video => video.currentSrc && video.readyState >= 2);
        return video && video.currentTime - window.__editorBench.playInitialTime >= sampleMs / 1000;
      }, { timeout: config.playbackSampleMs + 10000 }, config.playbackSampleMs);
      const playback = await page.evaluate(() => {
        const video = [...document.querySelectorAll('video')].find(video => video.currentSrc && video.readyState >= 2);
        const before = window.__editorBench.beforeQuality, after = video.getVideoPlaybackQuality();
        return { responseMs: window.__editorBench.playResponseMs, total: after.totalVideoFrames - before.totalVideoFrames, dropped: after.droppedVideoFrames - before.droppedVideoFrames };
      });
      await page.click('button[aria-label="暂停"]');
      if (playback.total <= 0 || playback.dropped < 0 || playback.dropped > playback.total) throw new Error('No valid playback frame sample');
      metrics.playResponseMs = playback.responseMs;
      metrics.droppedFrameRatio = playback.dropped / playback.total;
      detail.playback = playback;
    });
    await attempt('seek', async () => {
      // Pause after a failed playback attempt too; source changes are timed to a presented frame.
      const pause = await page.$('button[aria-label="暂停"]');
      if (pause) await pause.click();
      await page.evaluate(() => {
        const video = [...document.querySelectorAll('video')].find(video => video.currentSrc && video.readyState >= 2);
        const track = document.querySelector('[data-editor-timeline-track]');
        if (!video || !track || !video.requestVideoFrameCallback) throw new Error('Seek controls unavailable');
        window.__editorBench.seekResponseMs = null;
        track.addEventListener('pointerdown', () => {
          const start = performance.now();
          const initialTime = video.currentTime;
          const frame = (_now, metadata) => {
            if (Math.abs(metadata.mediaTime - initialTime) > .15) window.__editorBench.seekResponseMs = performance.now() - start;
            else video.requestVideoFrameCallback(frame);
          };
          video.requestVideoFrameCallback(frame);
        }, { once: true, capture: true });
      });
      await page.$eval('[data-editor-timeline-track]', track => track.scrollIntoView({ block: 'center' }));
      const point = await page.$eval('[data-editor-timeline-track]', track => { const rect = track.getBoundingClientRect(); return { x: rect.left + rect.width * .55, y: rect.top + rect.height / 2 }; });
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(() => Number.isFinite(window.__editorBench.seekResponseMs), { timeout: 10000 });
      metrics.seekResponseMs = await page.evaluate(() => window.__editorBench.seekResponseMs);
    });
    const trimmed = await attempt('trim', async () => {
      await page.$eval('[data-handle="out"]', handle => handle.scrollIntoView({ block: 'center' }));
      const points = await page.evaluate(ratio => {
        const handle = document.querySelector('[data-handle="out"]'), track = document.querySelector('[data-editor-timeline-track]');
        if (!handle || !track) throw new Error('Trim controls unavailable');
        const a = handle.getBoundingClientRect(), b = track.getBoundingClientRect();
        window.__editorBench.trimStart = null; window.__editorBench.trimResponseMs = null;
        handle.addEventListener('pointerdown', () => { window.__editorBench.trimStart = performance.now(); }, { once: true, capture: true });
        return { from: { x: a.left + a.width / 2, y: a.top + a.height / 2 }, to: { x: b.left + b.width * ratio, y: a.top + a.height / 2 } };
      }, config.exportTrimRatio);
      await page.mouse.move(points.from.x, points.from.y); await page.mouse.down();
      await page.mouse.move(points.to.x, points.to.y, { steps: 1 }); await page.mouse.up();
      await page.waitForFunction(ratio => {
        const position = Number.parseFloat(document.querySelector('[data-handle="out"]')?.style.left ?? '');
        if (Number.isFinite(window.__editorBench.trimStart) && Math.abs(position - ratio * 100) < 2) {
          window.__editorBench.trimResponseMs ??= performance.now() - window.__editorBench.trimStart;
          return true;
        }
        return false;
      }, { timeout: 10000 }, config.exportTrimRatio);
      const trimResponseMs = await page.evaluate(() => window.__editorBench.trimResponseMs);
      const durationMs = await page.evaluate(() => {
        const text = document.querySelector('input[aria-label="定位时间"]')?.parentElement?.textContent ?? '';
        const match = text.match(/\/\s*(\d+):(\d+)\.(\d{3})/);
        return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(match[3]) : null;
      });
      if (!Number.isFinite(durationMs) || Math.abs(durationMs - config.fixture.durationMs * config.exportTrimRatio) > 150) throw new Error('Edited duration did not reflect the trim');
      metrics.trimResponseMs = trimResponseMs;
      detail.editedDurationMs = durationMs;
      return true;
    });
    if (trimmed) await attempt('export', async () => {
      await page.evaluate(() => { window.__editorBench.exportArmed = true; window.__editorBench.exportBlob = null; });
      const start = Date.now();
      await page.click('[data-editor-export-phase] button');
      await page.waitForFunction(() => ['done', 'error'].includes(document.querySelector('[data-editor-export-phase]')?.dataset.editorExportPhase), { timeout: 180000 });
      const exported = await page.evaluate(async () => {
        const element = document.querySelector('[data-editor-export-phase]');
        if (element.dataset.editorExportPhase !== 'done') throw new Error(element.textContent?.slice(0, 500) || 'Export failed');
        const blob = window.__editorBench.exportBlob;
        const header = blob ? new Uint8Array(await blob.slice(4, 8).arrayBuffer()) : [];
        return { elapsedMs: Number(element.dataset.editorExportElapsedMs), bytes: Number(element.dataset.editorExportBytes), engine: element.dataset.editorExportEngine, mp4Header: String.fromCharCode(...header) };
      });
      exported.wallMs = Date.now() - start;
      if (exported.bytes <= 0 || !exported.engine || exported.mp4Header !== 'ftyp') throw new Error('Export did not produce a valid MP4');
      metrics.exportRtf = exported.wallMs / detail.editedDurationMs;
      detail.export = exported;
    });
  }
  const observations = await page.evaluate(() => ({ supported: window.__editorBench.longTaskSupported, entries: window.__editorBench.longTasks }));
  metrics.longTaskCount = observations.supported ? observations.entries.length : null;
  detail.longTasks = observations.entries;
  return { metrics, failures, detail };
}
