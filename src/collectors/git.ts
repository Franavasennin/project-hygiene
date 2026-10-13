import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BranchFact, GitFacts } from '../core/types.js';

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
    const { stdout } = await run('git', ['--no-optional-locks', ...args], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10_000,
    });
    return stdout;
  } catch {
    return null;
  }
}

const lines = (s: string | null): string[] =>
  s ? s.split('\n').map((l) => l.trim()).filter(Boolean) : [];

/** Parsea salida NUL-separada de git (opcion -z). Devuelve las rutas no vacias. */
function splitNul(s: string | null): string[] {
  return s ? s.split('\0').filter(Boolean) : [];
}

/**
 * Resuelve la rama por defecto en el orden de la spec §7: origin/HEAD, la
 * rama configurada en .hygienerc.yml, main, master. null si ninguna existe;
 * en ese caso las reglas de rama no emiten hallazgo.
 */
async function resolveDefaultBranch(cwd: string, configured?: string): Promise<string | null> {
  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head) {
    const name = head.trim().split('/').pop();
    if (name) return name;
  }
  const candidates = configured ? [configured, 'main', 'master'] : ['main', 'master'];
  for (const candidate of candidates) {
    const ok = await git(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
    if (ok) return candidate;
  }
  return null;
}

async function collectBranches(cwd: string, defaultBranch: string | null): Promise<BranchFact[]> {
  const raw = lines(await git(cwd, [
    'for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(upstream:short)%09%(committerdate:unix)',
  ]));
  const merged = defaultBranch
    ? new Set(lines(await git(cwd, ['branch', '--merged', defaultBranch, '--format=%(refname:short)'])))
    : new Set<string>();
  return raw
    .map((line) => {
      const [name = '', upstream = '', ts = '0'] = line.split('\t');
      return { name, upstream: upstream || null, lastCommitMs: Number(ts) * 1000, merged: merged.has(name) };
    })
    .filter((b) => b.name !== '');
}

async function collectHistory(cwd: string, limit: number): Promise<{ paths: Set<string>; truncated: boolean }> {
  const total = Number((await git(cwd, ['rev-list', '--all', '--count']))?.trim() ?? '0');
  const out = await git(cwd, ['log', '--all', '-n', String(limit), '--name-only', '--format=', '-z']);
  const paths = new Set(splitNul(out).map((p) => p.replace(/^\n+/, '')).filter(Boolean));
  return { paths, truncated: total > limit };
}

export interface GitOptions {
  defaultBranch?: string;
  maxHistoryCommits?: number;
}

export async function collectGit(cwd: string, opts: GitOptions = {}): Promise<GitFacts> {
  const rootOut = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!rootOut) return empty();

  const tracked = new Set(splitNul(await git(cwd, ['ls-files', '-z'])));
  const ignored = new Set(
    splitNul(
      await git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']),
    ),
  );

  const statusRaw = splitNul(await git(cwd, ['status', '--porcelain', '-z']));
  const dirty = new Set<string>();
  for (let i = 0; i < statusRaw.length; i++) {
    const entry = statusRaw[i];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const rest = entry.slice(3);
    const isRenameOrCopy = code[0] === 'R' || code[0] === 'C';
    if (isRenameOrCopy) {
      // La entrada NUL siguiente es la ruta ORIGEN; `rest` en la entrada actual
      // es la ruta DESTINO (nueva) bajo -z.
      dirty.add(rest);
      i++; // consume la entrada del origen sin usarla, no aporta al set de dirty
    } else if (rest) {
      dirty.add(rest);
    }
  }

  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null;
  const stashTimesMs = lines(await git(cwd, ['stash', 'list', '--format=%ct']))
    .map((s) => Number(s) * 1000)
    .filter((n) => Number.isFinite(n));
  const ignoredDirs = new Set(
    splitNul(await git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']))
      .filter((p) => p.endsWith('/'))
      .map((p) => p.slice(0, -1)),
  );
  const defaultBranch = await resolveDefaultBranch(cwd, opts.defaultBranch);
  const history = await collectHistory(cwd, opts.maxHistoryCommits ?? 5_000);

  return {
    isRepo: true,
    root: rootOut.trim(),
    currentBranch: branch,
    defaultBranch,
    trackedFiles: tracked,
    ignoredFiles: ignored,
    dirtyFiles: dirty,
    stashCount: stashTimesMs.length,
    ignoredDirs,
    stashTimesMs,
    branches: await collectBranches(cwd, defaultBranch),
    historyPaths: history.paths,
    historyTruncated: history.truncated,
  };
}
