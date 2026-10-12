import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const run = promisify(execFile);
const RULES = path.join(process.cwd(), 'rules');
const OLD = '2020-01-01T00:00:00';
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-r3g-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function file(rel: string, content = 'x'): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content);
}
async function git(args: string[], date?: string): Promise<void> {
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env;
  await run('git', args, { cwd: root, env });
}
async function repo(): Promise<void> {
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@t.t']);
  await git(['config', 'user.name', 'T']);
}
async function commit(rel: string, content = 'x', date?: string): Promise<void> {
  await file(rel, content);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', `c ${rel}`], date);
}
async function audit() {
  return runAudit({ root, rulesDir: RULES });
}
async function hallazgos(rule: string): Promise<string[]> {
  return (await audit()).findings.filter((f) => f.ruleId === rule).map((f) => f.path).sort();
}

describe('reglas de git', () => {
  it('GIT-NOREPO-001: proyecto con manifiesto y sin repositorio', async () => {
    await file('app/package.json', '{}');
    expect(await hallazgos('GIT-NOREPO-001')).toEqual(['app']);
  });

  it('GIT-IGNORE-001: repositorio sin .gitignore', async () => {
    await repo();
    expect(await hallazgos('GIT-IGNORE-001')).toEqual(['.']);
    await file('.gitignore', 'dist/\n');
    expect(await hallazgos('GIT-IGNORE-001')).toEqual([]);
  });

  it('GIT-WORKTREE-001: .git que apunta a un gitdir inexistente', async () => {
    await file('.git', 'gitdir: ./no/existe\n');
    expect(await hallazgos('GIT-WORKTREE-001')).toEqual(['.']);
  });

  it('GIT-STASH-001: stash antiguo', async () => {
    await repo();
    await commit('a.txt', 'uno');
    await file('a.txt', 'dos');
    await git(['stash', '-q'], OLD);
    expect(await hallazgos('GIT-STASH-001')).toEqual(['.']);
  });

  it('GIT-BRANCH-001: rama huerfana sin actividad', async () => {
    await repo();
    await commit('a.txt', 'uno');
    await git(['checkout', '-q', '-b', 'vieja']);
    await commit('b.txt', 'dos', OLD);
    await git(['checkout', '-q', 'main']);
    expect(await hallazgos('GIT-BRANCH-001')).toEqual(['.']);
  });
});

describe('reglas de seguridad', () => {
  it('SEC-HIST-001: secreto en el historico aunque ya no este en el arbol', async () => {
    await repo();
    await commit('.env', 'K=v');
    await git(['rm', '-q', '.env']);
    await git(['commit', '-q', '-m', 'borra']);
    expect(await hallazgos('SEC-HIST-001')).toEqual(['.']);
  });

  it('SEC-HIST-001 ignora un .env.example', async () => {
    await repo();
    await commit('.env.example', 'K=');
    expect(await hallazgos('SEC-HIST-001')).toEqual([]);
  });

  it('SEC-HIST-001 con historial truncado da RULE_EXECUTION_LIMIT, no limpio', async () => {
    await repo();
    await commit('a.txt', '1');
    await commit('b.txt', '2');
    const result = await runAudit({ root, rulesDir: RULES, limits: { maxGitHistoryCommits: 1 } });
    expect(result.limits).toContainEqual({ ruleId: 'SEC-HIST-001', limit: 'max_git_history_commits' });
    expect(result.score.clean).toBe(false);
  });

  it('SEC-DB-001: volcado versionado fuera de fixtures', async () => {
    await repo();
    await commit('backup/dump.sql', 'CREATE TABLE t (id int);');
    await commit('tests/fixtures/db.sql', 'CREATE TABLE t (id int);');
    expect(await hallazgos('SEC-DB-001')).toEqual(['backup/dump.sql']);
  });

  it.runIf(process.platform !== 'win32')('SEC-PERM-001: clave privada legible por otros', async () => {
    await file('id_rsa', 'k');
    await chmod(path.join(root, 'id_rsa'), 0o644);
    expect(await hallazgos('SEC-PERM-001')).toEqual(['id_rsa']);
    await chmod(path.join(root, 'id_rsa'), 0o600);
    expect(await hallazgos('SEC-PERM-001')).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('SEC-PERM-001 en Windows se reporta como unsupported', async () => {
    await file('id_rsa', 'k');
    const result = await audit();
    expect(result.findings.some((f) => f.ruleId === 'SEC-PERM-001')).toBe(false);
    expect(result.unsupported?.some((u) => u.ruleId === 'SEC-PERM-001')).toBe(true);
  });
});
