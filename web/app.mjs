import { translate } from './i18n.mjs';
import { renderEditorDashboard } from './editor-view.mjs';
import { routesForEnvironment } from './routes.mjs';
import { routeStates, batchStates } from './budgets.mjs';
import { renderGroupState, renderStatusGroups } from './status.mjs';
import { latestForRoute, seriesFor, artifactAvailable, dataPresentation, escapeHtml as h } from './model.mjs';
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const state = { view: query.get('view') === 'editor' ? 'editor' : 'lighthouse', editorMetric: 'previewReadyMs', locale: query.get('lang') === 'en' ? 'en' : 'zh', environment: query.get('env') === 'staging' ? 'staging' : 'production', route: query.get('page') ?? 'landing', metric: 'performance', days: 30, loading: true, error: false, data: null };
const t = key => translate(state.locale, key);
const fmt = (value, key) => Number.isFinite(value) ? new Intl.NumberFormat(state.locale, { maximumFractionDigits: key === 'cls' ? 3 : 0 }).format(value) : '—';
const date = value => value ? new Intl.DateTimeFormat(state.locale === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
const units = key => t(key === 'cls' ? 'clsUnit' : key.endsWith('Ms') ? 'milliseconds' : 'scoreUnit');
const external = (url, text, classes = '') => url && /^https:\/\/github\.com\//.test(url) ? `<a class="${classes}" href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(text)} ↗</a>` : '';
const button = (value, text, selected, attribute) => `<button type="button" ${attribute}="${h(value)}" aria-pressed="${selected}">${h(text)}</button>`;

function localize() {
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
  document.title = `AI Creator · ${t('title')}`;
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-aria]')) element.setAttribute('aria-label', t(element.dataset.i18nAria));
  $('language').textContent = state.locale === 'zh' ? 'EN' : '中文';
}

function chart(points, metric, target) {
  if (!points.length) return `<p class="chart-empty">${h(t('noPoints'))}</p>`;
  const hasTarget = Number.isFinite(target);
  const max = metric === 'performance' ? 100 : Math.max(hasTarget ? target : 0, ...points.map(point => point.value), 0.01) * 1.18;
  const left = 74, right = 970, top = 26, bottom = 298;
  const first = Date.parse(points[0].date), last = Date.parse(points.at(-1).date);
  const x = point => first === last ? (left + right) / 2 : left + (Date.parse(point.date) - first) / (last - first) * (right - left);
  const y = value => bottom - value / max * (bottom - top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(fraction => `<line x1="${left}" x2="${right}" y1="${y(fraction * max)}" y2="${y(fraction * max)}" class="grid-line"/><text x="${left - 12}" y="${y(fraction * max) + 4}" text-anchor="end">${fmt(fraction * max, metric)}</text>`).join('');
  const line = points.length > 1 ? `<polyline points="${points.map(point => `${x(point)},${y(point.value)}`).join(' ')}" class="trend-line"/>` : '';
  const circles = points.map(point => `<circle cx="${x(point)}" cy="${y(point.value)}" r="4" class="trend-point"><title>${h(`${date(point.date)} · ${fmt(point.value, metric)} ${units(metric)}`)}</title></circle>`).join('');
  const targetLine = hasTarget ? `<line x1="${left}" x2="${right}" y1="${y(target)}" y2="${y(target)}" class="target-line"/><text x="${right}" y="${Math.max(16, y(target) - 8)}" text-anchor="end" class="target-label">${h(`${t('budget')} ${fmt(target, metric)}`)}</text>` : '';
  return `<svg viewBox="0 0 1000 358" role="img" aria-label="${h(`${t(metric)} · ${units(metric)} · ${t('dateAxis')}`)}"><title>${h(`${t(metric)} · ${units(metric)}`)}</title><text x="${left}" y="15">${h(`${t(metric)} · ${units(metric)}`)}</text>${ticks}${targetLine}${line}${circles}<text x="${left}" y="322">${h(date(points[0].date))}</text>${points.length > 1 ? `<text x="${right}" y="322" text-anchor="end">${h(date(points.at(-1).date))}</text>` : ''}<text x="${(left + right) / 2}" y="348" text-anchor="middle">${h(t('dateAxis'))}</text></svg>${points.length === 1 ? `<p class="single-point">${h(t('singlePoint'))}</p>` : ''}`;
}

function renderLoadStatus() {
  const view = dataPresentation(state);
  $('load-status').hidden = view.hidden;
  $('load-status').innerHTML = view.key ? `${h(t(view.key))}${view.retry ? ` <button type="button" id="retry">${h(t('retry'))}</button>` : ''}` : '';
}

function render() {
  localize();
  renderLoadStatus();
  if (!state.data) return;
  const { config, summaries, reports } = state.data;
  const editorHistory = state.data.editorSummaries ?? [];
  const editorView = state.view === 'editor';
  $('benchmark-views').innerHTML = [['lighthouse','pageLighthouse'],['editor','editorView']].map(([value,key])=>button(value,t(key),state.view===value,'data-view')).join('');
  $('lighthouse-view').hidden = editorView;
  $('editor-view').hidden = !editorView;
  $('history-nav').href = editorView ? '#editor-history' : '#history';
  if (editorView) $('editor-view').innerHTML = renderEditorDashboard({ history:editorHistory, environment:state.environment, locale:state.locale, metric:state.editorMetric, days:state.days });
  const visibleRoutes = routesForEnvironment(config, state.environment);
  if (!visibleRoutes.some(route => route.id === state.route)) state.route = visibleRoutes[0].id;
  const selected = visibleRoutes.find(route => route.id === state.route);
  const latest = latestForRoute(summaries, state.environment, state.route);
  const envSummaries = summaries.filter(summary => summary.environment === state.environment).toSorted((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const environment = config.environments[state.environment];
  const budgets = latest?.summary ?? config;
  $('environments').innerHTML = Object.keys(config.environments).map(id => button(id, t(id), state.environment === id, 'data-env')).join('');
  const latestEditor = editorHistory.filter(item=>item.environment===state.environment).toSorted((a,b)=>b.generatedAt.localeCompare(a.generatedAt))[0];
  $('freshness').textContent = `${t('lastUpdated')} ${date(editorView ? latestEditor?.generatedAt : envSummaries[0]?.generatedAt)}`;
  const stale = envSummaries[0] && Date.now() - Date.parse(envSummaries[0].generatedAt) > 18 * 3600000;
  $('notice').textContent = stale ? t('stale') : latest?.route.status === 'failed' ? t('failedNotice') : '';
  $('notice').hidden = !$('notice').textContent;
  $('routes').innerHTML = visibleRoutes.map(route => {
    const record = latestForRoute(summaries, state.environment, route.id);
    const states = routeStates(record?.route, record?.summary ?? config);
    return `<button type="button" class="route-button" data-route="${h(route.id)}" aria-pressed="${state.route === route.id}"><span>${h(t(route.labelKey))}</span><span class="route-score ${h(states.performance.status)}">${fmt(record?.route.metrics.performance, 'performance')}</span></button>`;
  }).join('');
  $('selected-page').textContent = t(selected.labelKey);
  $('site-link').textContent = `${environment.origin}${selected.path}`;
  $('site-link').href = `${environment.origin}${selected.path}`;
  $('selected-status').innerHTML = renderStatusGroups(routeStates(latest?.route, budgets), state.locale);
  const metricNames = ['performance', 'lcpMs', 'cls', 'tbtMs'];
  $('metrics').innerHTML = metricNames.map(key => `<div class="metric"><span>${h(t(key))}</span><strong>${fmt(latest?.route.metrics[key], key)}<small>${h(units(key))}</small></strong><span class="meta">${h(t('budget'))} ${['lcpMs', 'cls', 'tbtMs'].includes(key) ? '≤' : '≥'} ${fmt(budgets.targets?.[key], key)}</span></div>`).join('');
  $('categories').innerHTML = ['accessibility', 'bestPractices', 'seo'].map(key => `<span>${h(t(key))} <strong>${fmt(latest?.route.metrics[key], key)}</strong><small>${h(t('budget'))} ≥${fmt(budgets.targets?.[key], key)}</small></span>`).join('');
  $('periods').innerHTML = [[7, 'sevenDays'], [30, 'thirtyDays'], [90, 'ninetyDays'], [0, 'allTime']].map(([value, key]) => button(value, t(key), state.days === value, 'data-days')).join('');
  $('metric-buttons').innerHTML = metricNames.map(key => button(key, t(key), state.metric === key, 'data-metric')).join('');
  const points = seriesFor(summaries, state.environment, state.route, state.metric, state.days);
  $('chart').innerHTML = chart(points, state.metric, budgets.targets?.[state.metric]);
  $('point-count').textContent = `${points.length} ${t('points')}`;
  $('sample-data').innerHTML = `<table><thead><tr><th>${h(t('collectedAt'))}</th><th>${h(`${t(state.metric)} · ${units(state.metric)}`)}</th><th>${h(t('performanceStatus'))}</th><th>${h(t('qualityStatus'))}</th></tr></thead><tbody>${points.map(point => `<tr><td>${h(date(point.date))}</td><td class="mono">${fmt(point.value, state.metric)}</td>${['performance', 'quality'].map(group => `<td class="status-cell">${renderGroupState(point.states[group], group, state.locale, { label: false })}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const report = reports[state.environment]?.[state.route];
  const pageReports = report && report.summaryId === latest?.summary.id ? `<a class="primary-link" href="${h(report.html)}" target="_blank" rel="noopener">${h(t('viewReport'))} ↗</a><a href="${h(report.json)}" download>${h(t('downloadJson'))}</a>` : `<span class="meta">${h(t('reportUnavailable'))}</span>`;
  $('report-links').innerHTML = pageReports + (latest ? `<a href="history/${h(latest.summary.id)}.json" download>${h(t('downloadSummary'))}</a>` : '') + (artifactAvailable(latest?.summary.artifact) ? external(latest.summary.artifact.url, t('downloadBatch')) : '');
  $('overview').innerHTML = `<table><thead><tr>${['page', 'performanceStatus', 'qualityStatus', 'performance', 'lcpMs', 'cls', 'tbtMs', 'samples', 'collectedAt'].map(key => `<th>${h(t(key))}${key.endsWith('Ms') ? ' (ms)' : ''}</th>`).join('')}</tr></thead><tbody>${visibleRoutes.map(route => {
    const record = latestForRoute(summaries, state.environment, route.id);
    const states = routeStates(record?.route, record?.summary ?? config);
    return `<tr><th><button type="button" class="text-button" data-route="${h(route.id)}">${h(t(route.labelKey))}</button>${record?.route.regressions?.length ? `<small class="regression">${h(t('regressions'))}</small>` : ''}</th>${['performance', 'quality'].map(group => `<td class="status-cell">${renderGroupState(states[group], group, state.locale, { label: false })}</td>`).join('')}${metricNames.map(key => `<td class="mono">${fmt(record?.route.metrics[key], key)}</td>`).join('')}<td class="mono">${record ? `${record.route.successCount}/${record.route.expectedCount}` : '—'}</td><td class="meta nowrap">${h(date(record?.summary.generatedAt))}</td></tr>`;
  }).join('')}</tbody></table>`;
  const recent = envSummaries.filter(summary => !state.days || Date.now() - Date.parse(summary.generatedAt) <= state.days * 86400000).slice(0, 30);
  $('history-list').innerHTML = recent.map(summary => `<article class="history-row"><div><strong>${h(date(summary.generatedAt))}</strong><span class="meta mono">${h(summary.id)}</span></div><div>${renderStatusGroups(batchStates(summary), state.locale, { collapse: true })}<span class="meta">${h(t('coverage'))} ${summary.routes.filter(route => route.status !== 'failed').length}/${summary.routes.length}</span></div><div class="history-actions"><a href="history/${h(summary.id)}.json" download>${h(t('downloadSummary'))}</a>${artifactAvailable(summary.artifact) ? external(summary.artifact.url, t('downloadBatch')) : `<span class="meta">${h(t('reportExpired'))}</span>`}${external(summary.workflowUrl, t('runLink'))}</div></article>`).join('') || `<p class="meta">${h(t('noPoints'))}</p>`;
  const evidence = latest ? [[t('collectedAt'), `${date(latest.summary.generatedAt)} · ${t('timeZone')}`], [t('samples'), `${latest.route.successCount}/${latest.route.expectedCount}`], [t('toolVersion'), `Lighthouse ${latest.summary.versions?.lighthouse ?? '—'} · ${latest.summary.versions?.chrome ?? '—'}`], [t('collectorVersion'), latest.summary.collectorSha ?? '—'], [t('siteFingerprint'), latest.summary.siteSnapshot?.htmlSha256 ?? '—'], [t('siteRevision'), latest.summary.siteSnapshot?.sourceRevision ?? t('notPublished')], [t('sampleRange'), latest.route.ranges?.[state.metric] ? `${fmt(latest.route.ranges[state.metric].min, state.metric)} – ${fmt(latest.route.ranges[state.metric].max, state.metric)} ${units(state.metric)}` : '—']] : [];
  $('evidence').innerHTML = evidence.map(([key, value]) => `<div><dt>${h(key)}</dt><dd>${h(value)}</dd></div>`).join('');
  history.replaceState(null, '', `?env=${state.environment}&page=${state.route}&lang=${state.locale}&view=${state.view}${location.hash}`);
}

async function load() {
  $('refresh').disabled = true;
  state.loading = true;
  state.error = false;
  renderLoadStatus();
  $('dashboard').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('./data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Data unavailable');
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.summaries)) throw new Error('Invalid data');
    state.data = data;
    $('dashboard').hidden = !data.summaries.length && !data.editorSummaries?.length;
    state.loading = false;
    render();
  } catch {
    state.loading = false;
    state.error = true;
    renderLoadStatus();
  } finally { $('refresh').disabled = false; $('dashboard').removeAttribute('aria-busy'); }
}

document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.id === 'refresh' || target.id === 'retry') { load(); return; }
  if (target.id === 'language') state.locale = state.locale === 'zh' ? 'en' : 'zh';
  if (target.dataset.view) state.view = target.dataset.view;
  if (target.dataset.editorMetric) state.editorMetric = target.dataset.editorMetric;
  if (target.dataset.env) state.environment = target.dataset.env;
  if (target.dataset.route) state.route = target.dataset.route;
  if (target.dataset.metric) state.metric = target.dataset.metric;
  if (target.dataset.days !== undefined) state.days = Number(target.dataset.days);
  render();
});
localize();
load();
