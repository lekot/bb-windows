import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const branch = process.argv[2] ?? 'release/windows-candidate';
const manifest = JSON.parse(readFileSync(new URL('./release-exclusions.json', import.meta.url), 'utf8'));
if (typeof manifest.base !== 'string' || !Array.isArray(manifest.restoreUpstream) || manifest.restoreUpstream.some(value => typeof value !== 'string')) throw new Error('Invalid release exclusions.');
const temporary = mkdtempSync(join(tmpdir(), 'bb-release-index-'));
const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') };
function git(args, input, allowFailure = false) {
  const result = spawnSync('git', args, { env, input, windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr.toString());
  return result;
}
try {
  git(['check-ref-format', '--branch', branch]);
  if (git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], undefined, true).status === 0) throw new Error('Release branch already exists; choose a new name.');
  const source = git(['rev-parse', 'HEAD']).stdout.toString().trim();
  git(['merge-base', '--is-ancestor', manifest.base, source]);
  git(['read-tree', source]);
  const excluded = path => manifest.restoreUpstream.some(prefix => path.startsWith(prefix));
  const paths = git(['ls-files', '-z']).stdout.toString().split('\0').filter(path => path && excluded(path));
  git(['update-index', '--force-remove', '-z', '--stdin'], paths.join('\0') + '\0');
  const upstreamEntries = git(['ls-tree', '-r', '-z', manifest.base]).stdout.toString().split('\0').filter(entry => entry && excluded(entry.slice(entry.indexOf('\t') + 1)));
  if (upstreamEntries.length) git(['update-index', '-z', '--index-info'], upstreamEntries.join('\0') + '\0');
  const tree = git(['write-tree']).stdout.toString().trim();
  const commit = git(['commit-tree', tree, '-p', manifest.base], `Prepare native Windows distribution candidate\n\nSource snapshot: ${source}\nExclusions: scripts/windows/release-exclusions.json\n\n> AGENT GENERATED\n`).stdout.toString().trim();
  git(['update-ref', `refs/heads/${branch}`, commit, '0000000000000000000000000000000000000000']);
  console.log(JSON.stringify({ branch, commit, source, base: manifest.base, excludedPaths: paths.length, restoredUpstreamPaths: upstreamEntries.length }));
} finally {
  rmSync(temporary, { recursive: true });
}
