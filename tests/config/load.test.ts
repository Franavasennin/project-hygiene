import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, ConfigError, DEFAULT_LOOP } from '../../src/config/load.js';

let dir: string;
let user: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hyg-cfg-'));
  user = path.join(dir, 'no-existe.yml');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('loadConfig', () => {
  it('sin ficheros devuelve los valores por defecto', async () => {
    const c = await loadConfig(dir, user);
    expect(c).toEqual({ limits: {}, minConfidence: undefined, defaultBranch: undefined, loop: DEFAULT_LOOP });
  });

  it('lee el .hygienerc.yml del root', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), [
      'engine:',
      '  max_file_size_for_content_scan: 1MB',
      '  max_git_history_commits: 50',
      'planner:',
      '  min_confidence: 0.9',
      'git:',
      '  default_branch: trunk',
      'loop:',
      '  max_iterations: 3',
      '  require_approval_for_risk: [low, medium, high, unknown]',
    ].join('\n'));
    const c = await loadConfig(dir, user);
    expect(c.limits).toEqual({ maxFileSizeForContentScan: 1024 * 1024, maxGitHistoryCommits: 50 });
    expect(c.minConfidence).toBe(0.9);
    expect(c.defaultBranch).toBe('trunk');
    expect(c.loop.maxIterations).toBe(3);
    expect(c.loop.stopOnRegression).toBe(true);
    expect(c.loop.requireApprovalForRisk).toEqual(['low', 'medium', 'high', 'unknown']);
  });

  it('el rc del root gana a la config de usuario', async () => {
    const u = path.join(dir, 'user.yml');
    await writeFile(u, 'planner:\n  min_confidence: 0.5\ngit:\n  default_branch: develop\n');
    await writeFile(path.join(dir, '.hygienerc.yml'), 'planner:\n  min_confidence: 0.7\n');
    const c = await loadConfig(dir, u);
    expect(c.minConfidence).toBe(0.7);
    expect(c.defaultBranch).toBe('develop');
  });

  it('una clave desconocida es un error, no un aviso', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), 'planer:\n  min_confidence: 0.7\n');
    await expect(loadConfig(dir, user)).rejects.toBeInstanceOf(ConfigError);
  });

  it('un YAML roto es un ConfigError', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), 'planner: [\n');
    await expect(loadConfig(dir, user)).rejects.toBeInstanceOf(ConfigError);
  });

  it('un rc vacio es valido', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), '# nada\n');
    expect((await loadConfig(dir, user)).loop).toEqual(DEFAULT_LOOP);
  });
});
