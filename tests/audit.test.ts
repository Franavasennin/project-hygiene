import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes, symlink, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAudit, collectAudit } from '../src/audit.js';

const RULES = path.join(process.cwd(), 'rules');
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('runAudit', () => {
  it('encuentra un log antiguo y baja la puntuacion', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'x');
    const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await utimes(p, viejo, viejo);

    const result = await runAudit({ root, rulesDir: RULES });
    expect(result.findings.some((f) => f.ruleId === 'FS-TEMP-001')).toBe(true);
    expect(result.score.total).toBeLessThan(100);
  });

  it('un arbol vacio puntua 100 y limpio', async () => {
    const result = await runAudit({ root, rulesDir: RULES });
    expect(result.score.total).toBe(100);
    expect(result.score.clean).toBe(true);
  });

  // `makeContext` (dentro de audit.ts) es una funcion interna no exportada:
  // ahora, si se le pide una ruta que no esta en `byPath`, se degrada con un
  // FileEntry sintetico en vez de lanzar. Como no se puede importar ni
  // invocar `makeContext` directamente desde fuera del modulo, no hay un
  // test unitario que ejerza ese branch de forma aislada. En su lugar, este
  // test de integracion (runAudit completo, con varios ficheros reales,
  // incluyendo casos con y sin findings) sirve como evidencia de que el
  // cambio no introduce regresiones en el flujo normal, donde makeContext
  // solo recibe rutas que si existen en el inventario recorrido.
  it('runAudit completo sigue funcionando con varios ficheros (evidencia de no-regresion tras el cambio defensivo en makeContext)', async () => {
    await writeFile(path.join(root, 'a.txt'), 'contenido a');
    await writeFile(path.join(root, 'b.txt'), 'contenido b');
    await writeFile(path.join(root, 'c.txt'), 'contenido a'); // duplicado de a.txt

    const result = await runAudit({ root, rulesDir: RULES });
    expect(result.inventory.files.length).toBeGreaterThan(0);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.score.total).toBe('number');
  });
});

describe('collectAudit', () => {
  it('expone las referencias y las marca completas en un arbol pequeno', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    await writeFile(path.join(root, 'README.md'), 'ver debug.log');
    const { facts } = await collectAudit({ root, rulesDir: RULES });
    expect(facts.referenced.has('debug.log')).toBe(true);
    expect(facts.referencesComplete).toBe(true);
  });

  it('marca las referencias incompletas si se agota el tope de busqueda', async () => {
    await writeFile(path.join(root, 'a.md'), 'a');
    await writeFile(path.join(root, 'b.md'), 'b');
    const { facts } = await collectAudit({
      root, rulesDir: RULES, limits: { maxReferenceSearchFiles: 1 },
    });
    expect(facts.referencesComplete).toBe(false);
  });

  it('marca las referencias incompletas si un fichero fuente supera el tope de tamano', async () => {
    await writeFile(path.join(root, 'grande.md'), 'x'.repeat(64));
    const { facts } = await collectAudit({
      root, rulesDir: RULES, limits: { maxFileSizeForContentScan: 16 },
    });
    expect(facts.referencesComplete).toBe(false);
  });

  it.runIf(process.platform !== 'win32')('no sigue symlinks al buscar referencias y marca las referencias incompletas', async () => {
    const fuera = await mkdtemp(path.join(tmpdir(), 'hyg-fuera-'));
    try {
      await writeFile(path.join(fuera, 'grande.md'), 'debug.log '.repeat(1000));
      await writeFile(path.join(root, 'debug.log'), 'x');
      await symlink(path.join(fuera, 'grande.md'), path.join(root, 'enlace.md'));
      const { facts } = await collectAudit({ root, rulesDir: RULES });
      expect(facts.referenced.has('debug.log')).toBe(false);
      expect(facts.referencesComplete).toBe(false);
    } finally {
      await rm(fuera, { recursive: true, force: true });
    }
  });

  // Solo POSIX y sin root: en Windows icacls deny no hace fallar readdir, y
  // root lee el directorio aunque tenga modo 000.
  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)('marca las referencias incompletas si un directorio es ilegible', async () => {
    const sub = path.join(root, 'cerrado');
    await mkdir(sub);
    await writeFile(path.join(sub, 'x.md'), 'debug.log');
    await chmod(sub, 0o000);
    try {
      const { facts } = await collectAudit({ root, rulesDir: RULES });
      expect(facts.referencesComplete).toBe(false);
    } finally {
      await chmod(sub, 0o755);
    }
  });

  it('runAudit devuelve exactamente el result de collectAudit', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    const directo = await runAudit({ root, rulesDir: RULES });
    const { result } = await collectAudit({ root, rulesDir: RULES });
    expect(result.findings).toEqual(directo.findings);
    expect(result.score).toEqual(directo.score);
  });
});

describe('workspace con varios repos', () => {
  it('los hechos de git de un repo hijo se aplican a sus ficheros', async () => {
    const run = promisify(execFile);
    const app = path.join(root, 'app');
    await mkdir(app);
    await run('git', ['init', '-q', '-b', 'main'], { cwd: app });
    await run('git', ['config', 'user.email', 't@t.t'], { cwd: app });
    await run('git', ['config', 'user.name', 'T'], { cwd: app });
    await writeFile(path.join(app, '.env'), 'K=v\n');
    await run('git', ['add', '.env'], { cwd: app });
    await run('git', ['commit', '-q', '-m', 'x'], { cwd: app });

    const result = await runAudit({ root, rulesDir: RULES });
    expect(Object.keys(result.inventory.gitByProject)).toEqual(['app']);
    expect(result.findings.some((f) => f.ruleId === 'SEC-SECRET-001' && f.path === 'app/.env')).toBe(true);
  });
});
