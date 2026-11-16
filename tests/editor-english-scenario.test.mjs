import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { runEditorScenario } from '../scripts/editor-scenario.mjs';

const config = JSON.parse(await fs.readFile('editor-benchmark.config.json', 'utf8'));

// An in-memory English editor adapter exercises the actual page callbacks without a browser or network.
function editorPage({ missingPlay = false } = {}) {
  const queries = [], clicks = [], uploads = [], frames = [];
  let playing = false, dragging = false, tick = 0, address;
  const element = extra => ({
    listeners: {}, scrollIntoView() {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    dispatch(name) { const callback = this.listeners[name]; delete this.listeners[name]; callback?.(); },
    ...extra,
  });
  const video = {
    currentSrc: 'blob:fixture', readyState: 2, currentTime: 0,
    videoWidth: 640, videoHeight: 360, duration: 5,
    requestVideoFrameCallback(callback) { frames.push(callback); },
    getVideoPlaybackQuality() { return { totalVideoFrames: Math.floor(this.currentTime * 30), droppedVideoFrames: 0 }; },
  };
  const track = element({ getBoundingClientRect: () => ({ left: 0, top: 100, width: 100, height: 10 }) });
  const handle = element({ style: { left: '100%' }, getBoundingClientRect: () => ({ left: 95, top: 100, width: 10, height: 10 }) });
  const play = element({}), pause = element({});
  const phase = element({ dataset: { editorExportPhase: 'idle', editorExportElapsedMs: '10', editorExportBytes: '16', editorExportEngine: 'webcodecs' } });
  const time = { parentElement: { get textContent() { return `00:00.000 / 00:${(5 * Number.parseFloat(handle.style.left) / 100).toFixed(3).padStart(6, '0')}`; } } };
  const nodes = new Map([
    ['[data-editor-ready="true"]', element({})],
    ['[data-editor-preview-ready="true"]', element({})],
    ['[data-editor-filmstrip-ready="true"]', element({})],
    ['input[accept^="video/"]', { uploadFile: async file => uploads.push(file) }],
    ['button[aria-label="Play"]', missingPlay ? null : play],
    ['button[aria-label="Pause"]', pause],
    ['input[aria-label="Go to time"]', time],
    ['[data-editor-timeline-track]', track], ['[data-handle="out"]', handle],
    ['[data-editor-export-phase]', phase],
  ]);
  const find = selector => { queries.push(selector); return nodes.get(selector) ?? null; };
  const context = vm.createContext({
    window: {}, document: { querySelector: find, querySelectorAll: selector => selector === 'video' ? [video] : [] },
    performance: { now: () => ++tick }, URL: { createObjectURL: () => 'blob:export' }, Blob,
    PerformanceObserver: class { observe() {} },
  });
  const evaluate = async (callback, argument) => {
    context.argument = argument;
    return vm.runInContext(`(${callback.toString()})(argument)`, context);
  };
  const advance = () => {
    if (playing) video.currentTime += 0.1;
    for (const callback of frames.splice(0)) callback(tick++, { mediaTime: video.currentTime });
  };
  const click = async selector => {
    clicks.push(selector);
    if (selector === '[data-editor-export-phase] button') {
      phase.dataset.editorExportPhase = 'done';
      context.URL.createObjectURL(new Blob([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'video/mp4' }));
      return;
    }
    const target = find(selector);
    if (!target) throw new Error(`Missing English control: ${selector}`);
    target.dispatch('pointerdown');
    if (target === play) playing = true;
    if (target === pause) playing = false;
    advance();
  };
  pause.click = () => click('button[aria-label="Pause"]');
  const page = {
    goto: async url => { address = url; }, url: () => address,
    waitForSelector: async selector => { if (!find(selector)) throw new Error(`Missing ${selector}`); },
    evaluate, $: async selector => find(selector), $eval: async (selector, callback) => evaluate(callback, find(selector)), click,
    waitForFunction: async (callback, _options, argument) => {
      for (let index = 0; index < 100; index++) { if (await evaluate(callback, argument)) return; advance(); }
      throw new Error('Editor state did not become ready');
    },
    mouse: {
      click: async x => { track.dispatch('pointerdown'); video.currentTime = video.duration * x / 100; advance(); },
      move: async x => { if (dragging) handle.style.left = `${x}%`; },
      down: async () => { dragging = true; handle.dispatch('pointerdown'); },
      up: async () => { dragging = false; },
    },
  };
  return { page, queries, clicks, uploads };
}

test('the English editor completes import, playback, seeking, trimming and MP4 export', async () => {
  const adapter = editorPage();
  const result = await runEditorScenario(adapter.page, { url: `https://example.com${config.path}`, fixturePath: '/fixtures/editor-5s.mp4', config });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.detail.stages.map(stage => stage.name), ['navigation', 'filmstrip', 'import', 'playback', 'seek', 'trim', 'export']);
  assert.deepEqual(adapter.uploads, ['/fixtures/editor-5s.mp4']);
  assert.ok(adapter.clicks.includes('button[aria-label="Play"]'));
  assert.ok(adapter.clicks.includes('button[aria-label="Pause"]'));
  assert.ok(adapter.queries.includes('input[aria-label="Go to time"]'));
  assert.equal(result.detail.editedDurationMs, 3500);
  assert.equal(result.detail.export.mp4Header, 'ftyp');
  assert.ok(Number.isFinite(result.metrics.exportRtf));
  assert.equal(result.metrics.droppedFrameRatio, 0);
});

test('a missing English play control remains an incomplete sample while later stages recover', async () => {
  const { page } = editorPage({ missingPlay: true });
  const result = await runEditorScenario(page, { url: `https://example.com${config.path}`, fixturePath: '/fixtures/editor-5s.mp4', config });
  assert.deepEqual(result.failures.map(failure => failure.stage), ['playback']);
  assert.equal(result.metrics.playResponseMs, null);
  assert.equal(result.metrics.droppedFrameRatio, null);
  assert.equal(result.detail.stages.find(stage => stage.name === 'seek').status, 'success');
  assert.equal(result.detail.export.mp4Header, 'ftyp');
});
