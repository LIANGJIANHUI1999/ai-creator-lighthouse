import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function saveHistory(directory, message) {
  const git = args => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!existsSync(path.join(directory, 'history'))) return false;
  git(['add', 'history']);
  const diff = spawnSync('git', ['-C', directory, 'diff', '--cached', '--quiet']);
  if (diff.status === 0) return false;
  if (diff.status !== 1) throw new Error('Could not inspect staged history');
  git(['commit', '-m', message]);
  // Worktrees are detached, and the first destination branch does not yet exist.
  git(['push', 'origin', 'HEAD:refs/heads/monitor-data']);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(saveHistory('monitor-data', `Record Lighthouse batch ${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`) ? 'History committed and pushed' : 'Batch already archived');
}
