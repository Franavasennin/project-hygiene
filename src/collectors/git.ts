import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitFacts } from '../core/types.js';

const run = promisify(execFile);

function empty(): GitFacts {
  return {
    isRepo: false,
    root: null,
    currentBranch: null,
    defaultBranch: null,
    trackedFiles: new Set(),
    ignoredFiles: new Set(),
    dirtyFiles: new Set(),
    stashCount: 0,
  };
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

const lines = (s: string | null): string[] =>
  s ? s.split('\n').map((l) => l.trim()).filter(Boolean) : [];

/**
 * Resuelve la rama por defecto en el orden acordado: origin/HEAD, luego main,
 * luego master. Devuelve null si ninguna existe, y en ese caso las reglas de
 * rama no emiten hallazgo.
 */
async function resolveDefaultBranch(cwd: string): Promise<string | null> {
  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head) {
    const name = head.trim().split('/').pop();
    if (name) return name;
  }
  for (const candidate of ['main', 'master']) {
    const ok = await git(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
    if (ok) return candidate;
  }
  return null;
}

export async function collectGit(cwd: string): Promise<GitFacts> {
  const rootOut = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!rootOut) return empty();

  const tracked = new Set(lines(await git(cwd, ['ls-files'])));
  const ignored = new Set(
    lines(await git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard'])),
  );

  const status = lines(await git(cwd, ['status', '--porcelain']));
  const dirty = new Set(status.map((l) => l.slice(2).trim()).filter(Boolean));

  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null;
  const stashes = lines(await git(cwd, ['stash', 'list'])).length;

  return {
    isRepo: true,
    root: rootOut.trim(),
    currentBranch: branch,
    defaultBranch: await resolveDefaultBranch(cwd),
    trackedFiles: tracked,
    ignoredFiles: ignored,
    dirtyFiles: dirty,
    stashCount: stashes,
  };
}
