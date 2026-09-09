import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { ESCRITURAS_ASYNC, ESCRITURAS_SYNC } = vi.hoisted(() => ({
  ESCRITURAS_ASYNC: [
    'writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink',
    'rename', 'copyFile', 'chmod', 'truncate', 'symlink',
  ] as const,
  ESCRITURAS_SYNC: [
    'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync',
    'unlinkSync', 'renameSync', 'copyFileSync', 'chmodSync', 'truncateSync',
  ] as const,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = ReturnType<typeof vi.fn<(...args: any[]) => any>>;

const { asyncSpies, syncSpies } = vi.hoisted(() => ({
  asyncSpies: {} as Record<string, MockFn>,
  syncSpies: {} as Record<string, MockFn>,
}));

// NOTA TECNICA: no se usa `vi.spyOn(fsp, 'writeFile')` directamente sobre los
// namespaces `node:fs` / `node:fs/promises` porque, bajo ESM real (Node >=20,
// tal y como corre este proyecto: "type": "module"), las propiedades de un
// module namespace object son `configurable: false` por especificacion. Eso
// hace que `Object.defineProperty` (lo que `vi.spyOn` usa internamente) falle
// con "Cannot redefine property" -- verificado en este entorno concreto
// (Node 24 + Vitest 2.1.9): tanto `import * as fsp from 'node:fs/promises'`
// como el binding equivalente vía `import fs from 'node:fs'; fs.promises`
// resultan en objetos que, o bien son inmutables, o bien no son la misma
// referencia que ven los módulos de src/ (que usan imports nombrados). El
// mecanismo soportado por Vitest para interceptar módulos nativos de Node
// es `vi.mock`, que actúa a nivel del grafo de módulos (vite-node) y por
// tanto sí intercepta los imports nombrados usados en src/audit.ts y sus
// colaboradores. El contrato verificado (ninguna función de escritura se
// invoca) es idéntico; solo cambia el mecanismo de espionaje.

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of ESCRITURAS_ASYNC) {
    const original = (actual as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
    const fn = vi.fn(original);
    asyncSpies[name] = fn;
    wrapped[name] = fn;
  }
  return wrapped;
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

const { runAudit } = await import('../../src/audit.js');

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-ro-')); });
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('NN-4: audit es read-only', () => {
  it('no invoca ninguna operacion de escritura del sistema de ficheros', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    await writeFile(path.join(root, '.env'), 'API_KEY=abc');

    for (const fn of Object.values(asyncSpies)) fn.mockClear();
    for (const fn of Object.values(syncSpies)) fn.mockClear();

    await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });

    const usados = [...Object.entries(asyncSpies), ...Object.entries(syncSpies)]
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([name]) => name);

    expect(usados, 'audit escribio en disco').toHaveLength(0);
  });
});
