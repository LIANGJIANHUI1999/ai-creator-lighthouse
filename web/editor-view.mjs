import { translate } from './i18n.mjs';
import { escapeHtml as h, artifactAvailable } from './model.mjs';
import { editorMetrics, editorSeries } from './editor-model.mjs';
import { statusTag } from './status.mjs';

const date = (value, locale) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
export function editorValue(key, value, locale) {
  if (!Number.isFinite(value)) return '—';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: key === 'droppedFrameRatio' ? 2 : key === 'exportRtf' ? 3 : 1 });
  return number.format(key === 'droppedFrameRatio' ? value * 100 : value);
}
const unit = (key, locale) => key === 'droppedFrameRatio' ? '%' : key === 'exportRtf' ? '×' : key.endsWith('Ms') ? translate(locale, 'milliseconds') : translate(locale, 'countUnit');
export function editorMetricTable(batch, locale) {
  const t = key => translate(locale, key), { summary } = batch;
  return `<div class="table-scroll" tabindex="0"><table><thead><tr>${['editorMetric', 'editorMedian', 'sampleRange', 'budget', 'status', 'samples'].map(key => `<th>${h(t(key))}</th>`).join('')}</tr></thead><tbody>${editorMetrics.map(key => {
    const status = summary.statuses[key], range = summary.ranges[key];
    const reason = status === 'failed' ? `${t('samples')} ${summary.counts[key]}/${batch.runsPerBatch}` : status === 'pass' ? '' : `${t('budget')} ≤ ${editorValue(key, batch.targets[key], locale)} ${unit(key, locale)}${status === 'critical' ? ` · ${t('criticalThreshold')} > ${editorValue(key, batch.critical[key], locale)} ${unit(key, locale)}` : ''}`;
    return `<tr><th>${h(t(key))}</th><td class="mono">${editorValue(key, summary.metrics[key], locale)} ${h(unit(key, locale))}</td><td class="mono">${range ? `${editorValue(key, range.min, locale)} – ${editorValue(key, range.max, locale)}` : '—'}</td><td class="mono">≤ ${editorValue(key, batch.targets[key], locale)} ${h(unit(key, locale))}</td><td>${statusTag(status, locale)}${reason ? `<small class="status-reasons">${h(reason)}</small>` : ''}</td><td class="mono">${summary.counts[key]}/${batch.runsPerBatch}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function editorChart(points, metric, target, locale) {
  const t = key => translate(locale, key);
  if (!points.length) return `<p class="chart-empty">${h(t('noPoints'))}</p>`;
  const left = 80, right = 965, top = 32, bottom = 280;
  const max = Math.max(target, ...points.map(point => point.value), .001) * 1.2;
  const first = Date.parse(points[0].date), last = Date.parse(points.at(-1).date);
  const x = point => first === last ? (left + right) / 2 : left + (Date.parse(point.date) - first) / (last - first) * (right - left);
  const y = value => bottom - value / max * (bottom - top);
  const ticks = [0, .25, .5, .75, 1].map(ratio => `<line x1="${left}" x2="${right}" y1="${y(max * ratio)}" y2="${y(max * ratio)}" class="grid-line"/><text x="${left - 12}" y="${y(max * ratio) + 4}" text-anchor="end">${editorValue(metric, max * ratio, locale)}</text>`).join('');
  return `<svg viewBox="0 0 1000 340" role="img" aria-label="${h(`${t(metric)} · ${unit(metric, locale)} · ${t('dateAxis')}`)}"><title>${h(t(metric))}</title><text x="${left}" y="18">${h(`${t(metric)} · ${unit(metric, locale)}`)}</text>${ticks}<line x1="${left}" x2="${right}" y1="${y(target)}" y2="${y(target)}" class="target-line"/><text x="${right}" y="${y(target) - 8}" text-anchor="end">${h(`${t('budget')} ${editorValue(metric, target, locale)}`)}</text>${points.length > 1 ? `<polyline class="trend-line" points="${points.map(point => `${x(point)},${y(point.value)}`).join(' ')}"/>` : ''}${points.map(point => `<circle class="trend-point" cx="${x(point)}" cy="${y(point.value)}" r="4"><title>${h(`${date(point.date, locale)} · ${editorValue(metric, point.value, locale)} ${unit(metric, locale)}`)}</title></circle>`).join('')}<text x="${left}" y="306">${h(date(points[0].date, locale))}</text>${points.length > 1 ? `<text x="${right}" y="306" text-anchor="end">${h(date(points.at(-1).date, locale))}</text>` : ''}<text x="${(left + right) / 2}" y="331" text-anchor="middle">${h(t('dateAxis'))}</text></svg>${points.length === 1 ? `<p class="single-point">${h(t('singlePoint'))}</p>` : ''}`;
}
export function renderEditorDashboard({ history = [], environment, locale, metric = 'previewReadyMs', days = 30 }) {
  const t = key => translate(locale, key);
  const batches = history.filter(item => item.environment === environment).toSorted((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const latest = batches[0];
  if (!latest) return `<h2>${h(t('editorBenchmark'))}</h2><p>${h(t('editorEmpty'))}</p>`;
  if (!editorMetrics.includes(metric)) metric = 'previewReadyMs';
  const points = editorSeries(history, environment, metric, days);
  return `<section class="editor-intro"><div><h2>${h(t('editorBenchmark'))}</h2><p class="meta">${h(t('editorScope'))}</p></div><div>${statusTag(latest.summary.overall, locale)}<p class="meta">${h(t('samples'))} ${latest.summary.successCount}/${latest.runsPerBatch} · ${h(date(latest.generatedAt, locale))}</p></div></section>
    <p class="editor-lab-note">${h(t('editorLabNote'))}</p>
    <div class="workspace editor-workspace"><aside class="page-rail"><h2>${h(t('editorMetric'))}</h2><div class="editor-metrics" role="group" aria-label="${h(t('editorMetric'))}">${editorMetrics.map(key => `<button type="button" class="route-button" data-editor-metric="${key}" aria-pressed="${metric === key}"><span>${h(t(key))}</span><span class="route-score ${h(latest.summary.statuses[key])}">${editorValue(key, latest.summary.metrics[key], locale)}</span></button>`).join('')}</div><p class="rail-note">${h(t('editorRtfNote'))}</p></aside>
    <div class="workspace-main"><div class="section-heading"><h2>${h(t(metric))}</h2><div class="segmented compact" role="group" aria-label="${h(t('timeFilter'))}">${[[7,'sevenDays'],[30,'thirtyDays'],[90,'ninetyDays'],[0,'allTime']].map(([value,key])=>`<button type="button" data-days="${value}" aria-pressed="${days===value}">${h(t(key))}</button>`).join('')}</div></div>
    <div class="editor-chart">${editorChart(points, metric, latest.targets[metric], locale)}</div><div class="chart-caption"><p>${h(t('editorCompareNote'))}</p><span>${points.length} ${h(t('points'))}</span></div>
    <section class="overview-section editor-overview"><h2>${h(t('editorAllMetrics'))}</h2>${editorMetricTable(latest, locale)}</section>
    <section id="editor-history" class="editor-history"><h2>${h(t('history'))}</h2><p class="meta">${h(t('artifactNote'))}</p>${batches.slice(0,30).map(batch => `<article class="history-row"><div><strong>${h(date(batch.generatedAt, locale))}</strong><span class="meta mono">${h(batch.id)}</span></div><div>${statusTag(batch.summary.overall, locale)}<span class="meta">${h(t('samples'))} ${batch.summary.successCount}/${batch.runsPerBatch}</span></div><div class="history-actions"><a href="editor-history/${h(batch.id)}.json" download>${h(t('downloadSummary'))}</a><a href="reports/editor/${h(batch.id)}.html">${h(t('viewReport'))}</a>${artifactAvailable(batch.artifact) ? `<a href="${h(batch.artifact.url)}">${h(t('downloadBatch'))}</a>` : `<span class="meta">${h(t('reportExpired'))}</span>`}</div></article>`).join('')}</section>
    <details class="evidence"><summary>${h(t('evidence'))}</summary><dl>${[[t('toolVersion'),latest.versions.chrome],[t('editorEngine'),(latest.versions.engines??[]).join(', ')||'—'],[t('editorRenderer'),latest.versions.renderer??'—'],[t('editorCpu'),`${latest.versions.cpu??'—'} · ${latest.versions.cpuCount??'—'}`],[t('collectorVersion'),latest.collectorSha??'—'],[t('editorFixture'),`${latest.fixture.width}×${latest.fixture.height} · ${latest.fixture.durationMs/1000}s · ${latest.fixture.fps}fps · SHA-256 ${latest.fixture.sha256}`]].map(([key,value])=>`<div><dt>${h(key)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl></details></div></div>`;
}
export function renderEditorReport(batch, locale, css = '') {
  const t = key => translate(locale, key);
  return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(t('editorBenchmark'))}</title><style>${css}</style><body><main><div class="page-heading"><div><h1>${h(t('editorBenchmark'))}</h1><p>${h(batch.origin + batch.path)} · ${h(date(batch.generatedAt, locale))}</p></div>${statusTag(batch.summary.overall,locale)}</div><p>${h(t('editorLabNote'))}</p><p>${h(t('samples'))} ${batch.summary.successCount}/${batch.runsPerBatch}</p>${editorMetricTable(batch,locale)}<h2>${h(t('editorRuns'))}</h2><div class="table-scroll"><table><thead><tr><th>${h(t('batch'))}</th>${editorMetrics.map(key=>`<th>${h(t(key))}</th>`).join('')}</tr></thead><tbody>${batch.runs.map(run=>`<tr><th>${run.index}</th>${editorMetrics.map(key=>`<td>${editorValue(key,run.metrics[key],locale)} ${h(unit(key,locale))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${batch.failures.length?`<h2>${h(t('editorFailures'))}</h2><pre class="editor-errors">${h(JSON.stringify(batch.failures,null,2))}</pre>`:''}<p>${h(t('editorRtfNote'))}</p></main></body></html>`;
}
