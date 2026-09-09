import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectGit } from '../../src/collectors/git.js';

const run = promisify(execFile);
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('collectGit', () => {
  it('devuelve isRepo false fuera de un repositorio', async () => {
    const facts = await collectGit(root);
    expect(facts.isRepo).toBe(false);
    expect(facts.trackedFiles.size).toBe(0);
  });

  it('lista ficheros versionados y sucios', async () => {
    await run('git', ['init', '-b', 'main'], { cwd: root });
    await run('git', ['config', 'user.email', 't@t.t'], { cwd: root });
    await run('git', ['config', 'user.name', 'T'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'uno');
    await run('git', ['add', 'a.txt'], { cwd: root });
    await run('git', ['commit', '-m', 'x'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'dos');

    const facts = await collectGit(root);
    expect(facts.isRepo).toBe(true);
    expect(facts.trackedFiles.has('a.txt')).toBe(true);
    expect(facts.dirtyFiles.has('a.txt')).toBe(true);
    expect(facts.currentBranch).toBe('main');
  });
});
