import { translate } from './i18n.mjs';
import { escapeHtml as h } from './model.mjs';

export const groupLabels = { performance: 'performanceStatus', quality: 'qualityStatus' };

export function statusTag(status, locale) {
  return `<span class="status ${h(status)}">${h(translate(locale, status))}</span>`;
}

export function formatIssueValue(value, threshold, key, locale) {
  const digits = key === 'cls' ? 6 : 2;
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: digits });
  // A value barely outside the budget must not round back to the target it failed.
  return value !== threshold && format.format(value) === format.format(threshold)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value)
    : format.format(value);
}

export function issueText(issue, locale) {
  const t = key => translate(locale, key);
  const number = value => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
  if (issue.kind === 'incomplete') return `${t('samples')}: ${Number.isInteger(issue.actual) ? issue.actual : '—'}/${Number.isInteger(issue.expected) ? issue.expected : '—'}`;
  if (issue.kind === 'missing') return `${t('missingMetric')}: ${t(issue.key)}`;
  const unit = issue.key === 'cls' ? '' : ` ${t(issue.key.endsWith('Ms') ? 'milliseconds' : 'scoreUnit')}`;
  const critical = issue.status === 'critical' ? ` · ${t('criticalThreshold')} ${issue.lowerIsBetter ? '>' : '<'} ${number(issue.critical)}${unit}` : '';
  return `${t(issue.key)} ${formatIssueValue(issue.value, issue.target, issue.key, locale)}${unit} · ${t('budget')} ${issue.lowerIsBetter ? '≤' : '≥'} ${number(issue.target)}${unit}${critical}`;
}

export function renderGroupState(state, group, locale, { label = true, collapse = false } = {}) {
  const t = key => translate(locale, key);
  const items = state.issues.map(issue => `<li class="status-issue ${h(issue.status)}">${issue.pageLabelKey ? `<strong>${h(t(issue.pageLabelKey))}</strong> · ` : ''}${h(issueText(issue, locale))}</li>`).join('');
  const reasons = items ? `<ul class="status-reasons">${items}</ul>` : '';
  const detail = collapse && items ? `<details class="status-details"><summary>${h(t('unmetItems'))} (${state.issues.length})</summary>${reasons}</details>` : reasons;
  return `<div class="group-status" data-status-group="${h(group)}"><div class="status-heading">${label ? `<span class="status-label">${h(t(groupLabels[group]))}</span>` : ''}${statusTag(state.status, locale)}</div>${detail}</div>`;
}

export function renderStatusGroups(states, locale, options) {
  return Object.keys(groupLabels).map(group => renderGroupState(states[group], group, locale, options)).join('');
}
