import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const run = promisify(execFile);
const RULES = path.join(process.cwd(), 'rules');
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-r3-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function file(rel: string, content = 'x'): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content);
}
async function gitInit(rel = '.'): Promise<void> {
  const cwd = path.join(root, rel);
  await mkdir(cwd, { recursive: true });
  await run('git', ['init', '-q', '-b', 'main'], { cwd });
}
async function hallazgos(rule: string): Promise<string[]> {
  const result = await runAudit({ root, rulesDir: RULES });
  return result.findings.filter((f) => f.ruleId === rule).map((f) => f.path).sort();
}

describe('reglas de ficheros', () => {
  it('FS-ROOT-001: fichero suelto en la raiz de un workspace', async () => {
    await gitInit('app');
    await file('app/package.json', '{}');
    await file('notas.txt');
    await file('README.md');
    expect(await hallazgos('FS-ROOT-001')).toEqual(['notas.txt']);
  });

  it('FS-ROOT-001 no dispara si el root no es un workspace', async () => {
    await file('notas.txt');
    expect(await hallazgos('FS-ROOT-001')).toEqual([]);
  });

  it('FS-BOUNDARY-001: candidato con confianza insuficiente', async () => {
    await file('app/package.json', '{}');
    expect(await hallazgos('FS-BOUNDARY-001')).toEqual(['app']);
  });

  it('FS-GENERATED-001: node_modules sin ignorar en un repo', async () => {
    await gitInit();
    await file('node_modules/a.js');
    expect(await hallazgos('FS-GENERATED-001')).toEqual(['node_modules']);
  });

  it('FS-GENERATED-001 no dispara si esta ignorado', async () => {
    await gitInit();
    await file('.gitignore', 'node_modules/\n');
    await file('node_modules/a.js');
    expect(await hallazgos('FS-GENERATED-001')).toEqual([]);
  });

  it('FS-EMPTY-001: directorio vacio', async () => {
    await mkdir(path.join(root, 'vacio'));
    await file('lleno/a.txt');
    expect(await hallazgos('FS-EMPTY-001')).toEqual(['vacio']);
  });
});

describe('reglas de agentes', () => {
  it('AI-DOC-001: ficheros de instrucciones duplicados', async () => {
    await file('CLAUDE.md', 'reglas');
    await file('sub/CLAUDE.md', 'reglas');
    expect(await hallazgos('AI-DOC-001')).toEqual(['CLAUDE.md', 'sub/CLAUDE.md']);
  });

  it('AI-REPORT-001: informe que nada referencia', async () => {
    await file('audit-report.md', '# informe');
    expect(await hallazgos('AI-REPORT-001')).toEqual(['audit-report.md']);
  });

  it('AI-REPORT-001 no dispara si algo lo referencia', async () => {
    await file('audit-report.md', '# informe');
    await file('README.md', 'ver audit-report.md');
    expect(await hallazgos('AI-REPORT-001')).toEqual([]);
  });

  it('AI-OUTSIDE-001: directorio de agente fuera de todo proyecto', async () => {
    await gitInit('app');
    await file('app/package.json', '{}');
    await file('.claude/settings.json', '{}');
    expect(await hallazgos('AI-OUTSIDE-001')).toEqual(['.claude']);
  });

  it('AI-DUPDOC-001: documento que duplica el README', async () => {
    const texto = Array.from({ length: 40 }, (_, i) => `la herramienta audita el repositorio paso ${i}`).join('\n');
    await file('README.md', texto);
    await file('guia.md', `# Guia\n${texto}`);
    expect(await hallazgos('AI-DUPDOC-001')).toEqual(['guia.md']);
  });
});
