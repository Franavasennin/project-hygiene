import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { ESCRITURAS_ASYNC, ESCRITURAS_SYNC } = vi.hoisted(() => ({
  ESCRITURAS_ASYNC: [
    'writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink',
    'rename', 'copyFile', 'chmod', 'truncate', 'symlink',
    'open', 'write', 'ftruncate', 'cp', 'link', 'mkdtemp',
  ] as const,
  ESCRITURAS_SYNC: [
    'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync',
    'unlinkSync', 'renameSync', 'copyFileSync', 'chmodSync', 'truncateSync',
    'writeSync', 'ftruncateSync', 'cpSync', 'linkSync', 'mkdtempSync',
    'createWriteStream',
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
//
// LIMITE RESIDUAL: espiar 'open' (fs/promises) o 'open'/'openSync' solo
// detecta la llamada que abre el fichero, no las escrituras posteriores
// que se hagan sobre el FileHandle devuelto -- sus metodos (`filehandle
// .write(...)`, `.writeFile(...)`, etc.) son metodos de instancia de una
// clase, no exports nombrados del modulo `node:fs/promises`, y este
// mecanismo basado en `vi.mock` solo intercepta exports nombrados, nunca
// metodos de objetos devueltos en tiempo de ejecucion. Lo mismo aplica a
// un `fs.WriteStream` obtenido via `createWriteStream`: una vez creado,
// hace sus propias escrituras internas contra el descriptor de fichero
// (a traves de bindings nativos), fuera del alcance de este mock. Cerrar
// esta brecha por completo exigiria parchear los prototipos de
// `FileHandle` y `WriteStream`, lo cual queda fuera de alcance aqui. Se
// ha verificado por busqueda de texto que src/ no usa hoy ninguna de
// estas rutas (ni `.open(`, `.write(`, `.ftruncate(`, `.cp(`, `.link(`,
// `.mkdtemp(` ni `createWriteStream(`), asi que el limite es hoy teorico.

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

const { runAudit } = await import('../../src/audit.js');

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-ro-'));
  // Limpieza entre tests: descarta llamadas registradas por el test anterior
  // (o por el propio setup de mkdtemp/imports) para que cada test empiece
  // con los contadores de los spies a cero.
  for (const fn of Object.values(asyncSpies)) fn.mockClear();
  for (const fn of Object.values(syncSpies)) fn.mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('NN-4: audit es read-only', () => {
  it('no invoca ninguna operacion de escritura del sistema de ficheros', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    await writeFile(path.join(root, '.env'), 'API_KEY=abc');

    // Segunda limpieza, necesaria ademas de la del beforeEach: el writeFile
    // de fixture de arriba tambien pasa por los spies (mismo mock de
    // node:fs/promises), asi que hay que descartar esas llamadas de setup
    // antes de medir lo que hace runAudit. La limpieza del beforeEach solo
    // resetea lo acumulado *entre* tests, no lo que este mismo test acaba
    // de generar en su propio setup.
    for (const fn of Object.values(asyncSpies)) fn.mockClear();
    for (const fn of Object.values(syncSpies)) fn.mockClear();

    // Asercion positiva: si runAudit fallara silenciosamente (excepcion
    // capturada en algun try/catch, early return, etc.) y no hiciera nada,
    // la comprobacion de "no hay escrituras" de mas abajo pasaria en falso
    // -- un audit que no hace nada tampoco escribe nada. Esta asercion
    // obliga a que runAudit haya recorrido de verdad el arbol de ficheros.
    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });
    expect(result.inventory.files.length).toBeGreaterThanOrEqual(2);

    const usados = [...Object.entries(asyncSpies), ...Object.entries(syncSpies)]
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([name]) => name);

    expect(usados, 'audit escribio en disco').toHaveLength(0);
  });
});

// GUIA PARA EXTENDER ESTE FICHERO:
//
// (a) Si src/ empieza a usar una funcion de escritura de node:fs o
//     node:fs/promises que no esta en las listas ESCRITURAS_ASYNC /
//     ESCRITURAS_SYNC de arriba, basta con anadirla ahi -- el mock la
//     recoge automaticamente (se envuelve en un vi.fn y se registra en
//     asyncSpies/syncSpies sin tocar el resto del fichero).
//
// (b) Si se anade un segundo `it` a este `describe` (o a otro describe de
//     este fichero, dado que los mocks son a nivel de modulo), recuerda que
//     `asyncSpies`/`syncSpies` son registros compartidos a nivel de modulo,
//     no locales al test. El `beforeEach` limpia las llamadas acumuladas
//     entre tests, pero si el nuevo test hace su propio setup con
//     escrituras (fixtures, ficheros de prueba, etc.) antes de invocar la
//     funcion bajo prueba, hay que volver a limpiar los spies justo
//     despues de ese setup y antes de medir -- exactamente el mismo patron
//     que usa el test existente arriba (dos limpiezas: una en beforeEach
//     entre tests, otra tras el propio setup del test).
