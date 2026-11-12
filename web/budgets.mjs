export const lowerIsBetter = new Set(['lcpMs', 'cls', 'tbtMs']);
export const statusGroups = {
  performance: ['performance', 'lcpMs', 'cls', 'tbtMs'],
  quality: ['accessibility', 'bestPractices', 'seo'],
};

export function metricStatus(key, value, config) {
  if (!Number.isFinite(value)) return 'failed';
  if (lowerIsBetter.has(key)) return value > config.critical[key] ? 'critical' : value > config.targets[key] ? 'warning' : 'pass';
  return value < config.critical[key] ? 'critical' : value < config.targets[key] ? 'warning' : 'pass';
}

export function worstStatus(statuses) {
  return ['failed', 'critical', 'warning', 'pass'].find(status => statuses.includes(status)) ?? 'unknown';
}

export function routeStates(route, config) {
  return Object.fromEntries(Object.entries(statusGroups).map(([group, keys]) => {
    if (!route) return [group, { status: 'unknown', issues: [] }];
    const issues = [], notes = [];
    if (!Number.isInteger(route.successCount) || !Number.isInteger(route.expectedCount) || route.expectedCount < 1 || route.successCount !== route.expectedCount) {
      issues.push({ kind: 'incomplete', status: 'failed', actual: route.successCount, expected: route.expectedCount });
    }
    for (const key of keys) {
      let value = route.metrics?.[key];
      const target = config.targets?.[key], critical = config.critical?.[key];
      let labelKey;
      if (key === 'seo' && route.seoPolicy === 'noindex' && Number.isFinite(value)) {
        const assessment = route.seoAssessment;
        if (!assessment?.complete || assessment.policy !== 'noindex' || assessment.sampleCount !== route.expectedCount || assessment.expectedCount !== route.expectedCount || !Number.isFinite(assessment.otherScore) || assessment.otherScore < 0 || assessment.otherScore > 100) {
          issues.push({ kind: 'seoPolicyMissing', key, status: 'failed' });
          continue;
        }
        if (!assessment.noindexConfirmed || !assessment.evidence?.length) issues.push({ kind: 'seoPolicyMismatch', key, status: 'critical' });
        else notes.push({ kind: 'expectedNoindex', rawScore: value, otherScore: assessment.otherScore });
        value = assessment.otherScore;
        labelKey = 'seoOtherAudits';
      }
      if (![value, target, critical].every(Number.isFinite)) {
        issues.push({ kind: 'missing', key, status: 'failed' });
        continue;
      }
      const status = metricStatus(key, value, config);
      if (status !== 'pass') issues.push({ kind: 'metric', key, value, target, critical, status, lowerIsBetter: lowerIsBetter.has(key), ...(labelKey ? { labelKey } : {}) });
    }
    return [group, { status: worstStatus(issues.length ? issues.map(issue => issue.status) : ['pass']), issues, ...(notes.length ? { notes } : {}) }];
  }));
}

export function batchStates(summary) {
  const config = summary;
  const states = summary.routes.map(route => ({ route, groups: routeStates(route, config) }));
  return Object.fromEntries(Object.keys(statusGroups).map(group => [group, {
    status: worstStatus(states.map(state => state.groups[group].status)),
    issues: states.flatMap(({ route, groups }) => groups[group].issues.map(issue => ({ ...issue, pageLabelKey: route.labelKey }))),
    notes: states.flatMap(({ route, groups }) => (groups[group].notes ?? []).map(note => ({ ...note, pageLabelKey: route.labelKey }))),
  }]));
}
