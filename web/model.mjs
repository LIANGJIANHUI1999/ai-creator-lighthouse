export function latestForRoute(summaries, environment, routeId) {
  const summary = summaries.filter(item => item.environment === environment && item.routes.some(route => route.id === routeId)).toSorted((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  return summary ? { summary, route: summary.routes.find(route => route.id === routeId) } : null;
}
export function seriesFor(summaries, environment, routeId, metric, days, now = Date.now()) {
  const latest = latestForRoute(summaries, environment, routeId);
  if (!latest) return [];
  const comparisonKey = latest.summary.comparisonKey ?? summaries.filter(summary => summary.environment === environment && summary.comparisonKey && summary.routes.some(route => route.id === routeId)).toSorted((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]?.comparisonKey;
  return summaries.filter(summary => summary.environment === environment && summary.comparisonKey === comparisonKey && summary.runsPerRoute === latest.summary.runsPerRoute && (!days || now - Date.parse(summary.generatedAt) <= days * 86400000))
    .flatMap(summary => {
      const route = summary.routes.find(item => item.id === routeId);
      return route && route.status !== 'failed' && Number.isFinite(route.metrics[metric]) ? [{ id: summary.id, date: summary.generatedAt, value: route.metrics[metric], status: route.status }] : [];
    }).toSorted((a, b) => a.date.localeCompare(b.date));
}
export function artifactAvailable(artifact, now = Date.now()) {
  return Boolean(artifact?.url && Date.parse(artifact.expiresAt) > now);
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
