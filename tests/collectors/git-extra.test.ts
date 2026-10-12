import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectGit } from '../../src/collectors/git.js';

const run = promisify(execFile);
let root: string;

async function git(args: string[], date?: string): Promise<void> {
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env;
  await run('git', args, { cwd: root, env });
}

async function commit(file: string, content: string, date?: string): Promise<void> {
  await writeFile(path.join(root, file), content);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', `c ${file}`], date);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-gitx-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@t.t']);
  await git(['config', 'user.name', 'T']);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('collectGit, hechos ampliados', () => {
  it('lista los directorios ignorados sin barra final', async () => {
    await commit('.gitignore', 'node_modules/\n');
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'a.js'), 'x');
    const g = await collectGit(root);
    expect(g.ignoredDirs?.has('node_modules')).toBe(true);
  });

  it('fecha los stashes', async () => {
    await commit('a.txt', 'uno');
    await writeFile(path.join(root, 'a.txt'), 'dos');
    await git(['stash', '-q'], '2020-01-01T00:00:00');
    const g = await collectGit(root);
    expect(g.stashCount).toBe(1);
    expect(g.stashTimesMs?.[0]).toBe(Date.parse('2020-01-01T00:00:00'));
  });

  it('describe las ramas: upstream, fecha y si estan fusionadas', async () => {
    await commit('a.txt', 'uno');
    await git(['branch', 'fusionada']);
    await git(['checkout', '-q', '-b', 'vieja']);
    await commit('b.txt', 'dos', '2020-01-01T00:00:00');
    await git(['checkout', '-q', 'main']);
    const g = await collectGit(root);
    expect(g.defaultBranch).toBe('main');
    const vieja = g.branches?.find((b) => b.name === 'vieja');
    expect(vieja).toMatchObject({ upstream: null, merged: false, lastCommitMs: Date.parse('2020-01-01T00:00:00') });
    expect(g.branches?.find((b) => b.name === 'fusionada')?.merged).toBe(true);
  });

  it('recoge las rutas del historial, incluidas las borradas', async () => {
    await commit('.env', 'K=v');
    await git(['rm', '-q', '.env']);
    await git(['commit', '-q', '-m', 'borra']);
    const g = await collectGit(root);
    expect(g.historyPaths?.has('.env')).toBe(true);
    expect(g.historyTruncated).toBe(false);
  });

  it('marca el historial truncado si supera el tope', async () => {
    await commit('a.txt', '1');
    await commit('b.txt', '2');
    const g = await collectGit(root, { maxHistoryCommits: 1 });
    expect(g.historyTruncated).toBe(true);
  });

  it('usa la rama por defecto configurada si no hay origin/HEAD, main ni master', async () => {
    await git(['checkout', '-q', '-b', 'trunk']);
    await commit('a.txt', '1');
    await git(['branch', '-q', '-D', 'main']).catch(() => undefined);
    const g = await collectGit(root, { defaultBranch: 'trunk' });
    expect(g.defaultBranch).toBe('trunk');
  });
});
