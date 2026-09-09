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
