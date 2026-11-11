export const editorMetrics = ['editorReadyMs', 'previewReadyMs', 'filmstripReadyMs', 'playResponseMs', 'seekResponseMs', 'trimResponseMs', 'droppedFrameRatio', 'longTaskCount', 'exportRtf'];
export function editorMetricStatus(key, value, count, expected, config) {
  if (count !== expected || expected < 1 || !Number.isFinite(value)) return 'failed';
  return value > config.critical[key] ? 'critical' : value > config.targets[key] ? 'warning' : 'pass';
}
const validMetric = (key, value) => Number.isFinite(value) && value >= 0 && (key !== 'droppedFrameRatio' || value <= 1) && (key !== 'longTaskCount' || Number.isInteger(value));
export function summarizeEditor(runs, expected, config) {
  const metrics = {}, counts = {}, ranges = {}, statuses = {};
  for (const key of editorMetrics) {
    const values = runs.map(run => run.metrics[key]).filter(value => validMetric(key, value)).toSorted((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    metrics[key] = !values.length ? null : values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    counts[key] = values.length;
    ranges[key] = values.length ? { min: values[0], max: values.at(-1) } : null;
    statuses[key] = editorMetricStatus(key, metrics[key], counts[key], expected, config);
  }
  const complete = runs.filter(run => editorMetrics.every(key => validMetric(key, run.metrics[key]))).length;
  const overall = ['failed', 'critical', 'warning'].find(status => Object.values(statuses).includes(status)) ?? 'pass';
  return { metrics, counts, ranges, statuses, successCount: complete, expectedCount: expected, overall };
}
export function editorSeries(history, environment, metric, days, now = Date.now()) {
  const ordered = history.filter(item => item.environment === environment).toSorted((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const latest = ordered.at(-1);
  if (!latest) return [];
  const key = latest.comparisonKey ?? ordered.findLast(item => item.comparisonKey)?.comparisonKey;
  return ordered.filter(item => item.comparisonKey === key && item.runsPerBatch === latest.runsPerBatch && (!days || now - Date.parse(item.generatedAt) <= days * 86400000) && item.summary.statuses[metric] !== 'failed' && Number.isFinite(item.summary.metrics[metric]))
    .map(item => ({ date: item.generatedAt, value: item.summary.metrics[metric] }));
}

export function validateEditorConfig(config) {
  if (config.schemaVersion !== 1 || !/^editor-workflow-v\d+$/.test(config.scenarioVersion)) throw new Error('Invalid editor scenario version');
  if (typeof config.path !== 'string' || !config.path.startsWith('/') || config.path.startsWith('//')) throw new Error('Editor requires a relative benchmark URL');
  const url = new URL(config.path, 'https://example.com');
  if (url.origin !== 'https://example.com' || !url.pathname.endsWith('/editor/') || url.searchParams.get('benchmark') !== '1') throw new Error('Editor requires an isolated benchmark URL');
  if (!/^fixtures\/[a-zA-Z0-9-]+\.mp4$/.test(config.fixture.file) || !/^[a-f0-9]{64}$/.test(config.fixture.sha256) || !(config.fixture.durationMs > 0 && config.fixture.durationMs <= 30000) || ![config.fixture.width, config.fixture.height, config.fixture.fps].every(value=>Number.isInteger(value)&&value>0)) throw new Error('Invalid fixed editor fixture');
  if (!(config.exportTrimRatio > 0 && config.exportTrimRatio < 1) || !(config.playbackSampleMs > 0 && config.playbackSampleMs < config.fixture.durationMs)) throw new Error('Invalid editor sample duration');
  for (const key of editorMetrics) if (!Number.isFinite(config.targets[key]) || !Number.isFinite(config.critical[key]) || config.targets[key] < 0 || config.critical[key] < config.targets[key]) throw new Error('Invalid editor budget');
  return config;
}
