export const devices = ['desktop', 'mobile'];

export function summaryDevice(summary) {
  return summary.device ?? (summary.profile?.formFactor === 'mobile' ? 'mobile' : 'desktop');
}

export function profileForDevice(config, device = 'desktop') {
  assertDevice(device);
  const profile = device === 'desktop' ? config.profile : config.mobileProfile;
  if (!profile) throw new Error('Device profile is not configured');
  return profile;
}

export function collectionDirectory(environment, device = 'desktop') {
  assertDevice(device);
  if (!/^[a-z][a-z-]*$/.test(environment)) throw new Error('Invalid environment');
  return device === 'mobile' ? `mobile/${environment}` : environment;
}

function assertDevice(device) {
  if (!devices.includes(device)) throw new Error('Unknown measurement device');
}

export function batchId(runId, attempt, environment, device = 'desktop') {
  collectionDirectory(environment, device);
  return `${runId}-${attempt}-${environment}${device === 'mobile' ? '-mobile' : ''}`;
}

export function artifactName(environment, device, runId, attempt) {
  collectionDirectory(environment, device);
  return `lighthouse-${device === 'mobile' ? 'mobile-' : ''}${environment}-${runId}-${attempt}`;
}
