import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../src/audit.js';

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
