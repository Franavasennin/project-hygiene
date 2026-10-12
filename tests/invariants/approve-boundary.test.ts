import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { ESCRITURAS_ASYNC, ESCRITURAS_SYNC } = vi.hoisted(() => ({
  ESCRITURAS_ASYNC: [
    'writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink',
    'rename', 'copyFile', 'chmod', 'truncate', 'symlink',
    'open', 'write', 'ftruncate', 'cp', 'link', 'mkdtemp',
    'utimes', 'lutimes', 'chown', 'lchown',
  ] as const,
  ESCRITURAS_SYNC: [
    'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync',
    'unlinkSync', 'renameSync', 'copyFileSync', 'chmodSync', 'truncateSync',
    'writeSync', 'ftruncateSync', 'cpSync', 'linkSync', 'mkdtempSync',
    'createWriteStream', 'utimesSync', 'lutimesSync', 'chownSync', 'lchownSync',
  ] as const,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = ReturnType<typeof vi.fn<(...args: any[]) => any>>;

const { asyncSpies, syncSpies } = vi.hoisted(() => ({
  asyncSpies: {} as Record<string, MockFn>,
  syncSpies: {} as Record<string, MockFn>,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of ESCRITURAS_ASYNC) {
    const original = (actual as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
    const fn = vi.fn(original);
    asyncSpies[name] = fn;
    wrapped[name] = fn;
  }
  return { ...wrapped, default: wrapped };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of ESCRITURAS_SYNC) {
    const original = (actual as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
    const fn = vi.fn(original);
    syncSpies[name] = fn;
    wrapped[name] = fn;
  }
  return { ...wrapped, default: wrapped };
});

const { main } = await import('../../src/cli/index.js');

// Funciones cuyo segundo argumento tambien es una ruta de destino.
const DOS_RUTAS = new Set(['rename', 'renameSync', 'copyFile', 'copyFileSync', 'link', 'linkSync', 'symlink']);

let root: string;
let home: string;
const homePrevio = process.env.HYGIENE_HOME;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-bnd-'));
  home = await mkdtemp(path.join(tmpdir(), 'hyg-bnd-home-'));
  process.env.HYGIENE_HOME = home;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
  if (homePrevio === undefined) delete process.env.HYGIENE_HOME;
  else process.env.HYGIENE_HOME = homePrevio;
});

describe('approve escribe solo en approvals/', () => {
  it('ninguna escritura cae fuera de HYGIENE_HOME/approvals', async () => {
    const log = path.join(root, 'debug.log');
    await writeFile(log, 'x');
    const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await utimes(log, viejo, viejo);
    for (const fn of Object.values(asyncSpies)) fn.mockClear();
    for (const fn of Object.values(syncSpies)) fn.mockClear();

    const code = await main(['approve', '--risk', 'safe', '--root', root], () => {});
    expect(code).toBe(0);

    const approvals = path.join(home, 'approvals');
    const llamadas = [...Object.entries(asyncSpies), ...Object.entries(syncSpies)]
      .flatMap(([name, fn]) => fn.mock.calls.map((args) => ({ name, args })));

    // Asercion positiva: approve tiene que haber escrito algo.
    expect(llamadas.length).toBeGreaterThan(0);

    for (const { name, args } of llamadas) {
      const rutas = DOS_RUTAS.has(name) ? [args[0], args[1]] : [args[0]];
      for (const r of rutas) {
        const rel = path.relative(approvals, path.resolve(String(r)));
        const fuera = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
        expect(fuera, `${name} escribio fuera de approvals: ${String(r)}`).toBe(false);
      }
    }
  });
});
