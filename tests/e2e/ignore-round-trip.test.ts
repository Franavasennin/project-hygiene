import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';

const existe = (p: string) => access(p).then(() => true, () => false);
let base: string;
let root: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };
const prev = { home: process.env.HYGIENE_HOME, user: process.env.HYGIENE_USER_CONFIG };

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-ign-'));
  root = path.join(base, 'ws');
  await mkdir(root);
  process.env.HYGIENE_HOME = path.join(base, 'home');
  process.env.HYGIENE_USER_CONFIG = path.join(base, 'no-existe.yml');
  salida = [];
  await promisify(execFile)('git', ['init', '-q', '-b', 'main'], { cwd: root });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  if (prev.home === undefined) delete process.env.HYGIENE_HOME; else process.env.HYGIENE_HOME = prev.home;
  if (prev.user === undefined) delete process.env.HYGIENE_USER_CONFIG; else process.env.HYGIENE_USER_CONFIG = prev.user;
});

describe('ignore de punta a punta', () => {
  it('approve, clean y restore de dos ignore sobre el mismo .gitignore', async () => {
    for (const dir of ['node_modules', 'dist']) {
      await mkdir(path.join(root, dir));
      await writeFile(path.join(root, dir, 'a.js'), dir);
    }
    type Plan = { operations: { id: string; type: string; path: string }[] };
    const leerPlan = async (): Promise<Plan> => {
      salida = [];
      await main(['plan', root, '--json'], print);
      return JSON.parse(salida.join('\n')) as Plan;
    };
    // Otros hallazgos tambien consumen IDs: se buscan los de los dos ignore.
    const ignores = (await leerPlan()).operations.filter((o) => o.type === 'ignore');
    expect(ignores.map((o) => o.path)).toEqual(['dist', 'node_modules']);
    const [primero, segundo] = ignores.map((o) => o.id) as [string, string];

    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(0);
    const gi = await readFile(path.join(root, '.gitignore'), 'utf8');
    expect(gi.split('\n').filter(Boolean).sort()).toEqual(['/dist/', '/node_modules/']);

    // Ya no queda nada que ignorar.
    expect((await leerPlan()).operations.filter((o) => o.type === 'ignore')).toEqual([]);

    // Se deshace en orden inverso: la segunda edicion primero.
    expect(await main(['restore', segundo], print)).toBe(0);
    expect(await main(['restore', primero], print)).toBe(0);
    expect(await existe(path.join(root, '.gitignore'))).toBe(false);
  });
});
