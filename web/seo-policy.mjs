/** Evaluate intentional workspace noindex without changing Lighthouse's raw score. */
export function assessSeoPolicy(lhr, policy) {
  if (policy !== 'noindex') return null;
  const crawl = lhr.audits?.['is-crawlable'];
  const evidence = (crawl?.details?.items ?? []).map(item => item.source?.snippet ?? item.source).filter(source => {
    if (typeof source !== 'string') return false;
    const meta = /<meta\b/i.test(source) && /\bname\s*=\s*["']robots["']/i.test(source)
      ? /\bcontent\s*=\s*["']([^"']*)["']/i.exec(source)?.[1] : undefined;
    const header = /^x-robots-tag\s*:\s*([^\n]*)/i.exec(source)?.[1];
    return (meta ?? header ?? '').toLowerCase().split(/[\s,]+/).includes('noindex');
  }).map(source => source.slice(0, 500));
  const refs = lhr.categories?.seo?.auditRefs?.filter(ref => ref.weight > 0 && ref.id !== 'is-crawlable') ?? [];
  let weight = 0, points = 0;
  let complete = refs.length > 0 && Number.isFinite(crawl?.score);
  const failedAudits = [];
  for (const ref of refs) {
    const audit = lhr.audits?.[ref.id];
    if (audit?.score === null && audit.scoreDisplayMode === 'notApplicable') continue;
    if (!Number.isFinite(audit?.score) || audit.score < 0 || audit.score > 1 || !Number.isFinite(ref.weight)) {
      complete = false;
      continue;
    }
    weight += ref.weight;
    points += audit.score * ref.weight;
    if (audit.score < 1) failedAudits.push(ref.id);
  }
  complete &&= weight > 0;
  return {
    policy, complete, noindexConfirmed: crawl?.score === 0 && evidence.length > 0,
    otherScore: complete ? Math.round(points / weight * 100) : null,
    evidence, failedAudits,
  };
}

export function summarizeSeoPolicy(samples, policy, expectedCount) {
  if (policy !== 'noindex') return null;
  const assessments = samples.map(sample => sample.seoAssessment);
  const complete = samples.length === expectedCount && expectedCount > 0 && assessments.every(value => value?.policy === policy && value.complete && Number.isFinite(value.otherScore));
  return {
    policy, complete, sampleCount: samples.length, expectedCount,
    noindexConfirmed: complete && assessments.every(value => value.noindexConfirmed && value.evidence?.length > 0),
    // Use the worst of all repeats so a single SEO failure cannot disappear in a median.
    otherScore: complete ? Math.min(...assessments.map(value => value.otherScore)) : null,
    evidence: [...new Set(assessments.flatMap(value => value?.evidence ?? []))],
    failedAudits: [...new Set(assessments.flatMap(value => value?.failedAudits ?? []))],
  };
}
