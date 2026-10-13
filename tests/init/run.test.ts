import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInit } from '../../src/init/run.js';
import { loadConfig } from '../../src/config/load.js';
import { findEntries } from '../../src/executor/manifest.js';
import { restoreEntry } from '../../src/executor/restore.js';

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-init-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
  await writeFile(path.join(root, 'package.json'), '{}');
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const leer = (rel: string) => readFile(path.join(root, rel), 'utf8');
const status = (actions: { file: string; status: string }[]) =>
  Object.fromEntries(actions.map((a) => [a.file, a.status]));

describe('runInit', () => {
  it('prepara un proyecto node nuevo', async () => {
    const actions = await runInit({ root, home });
    expect(status(actions)).toMatchObject({ '.gitignore': 'created', '.tmp/': 'created', '.hygienerc.yml': 'created' });
    const gi = await leer('.gitignore');
    expect(gi).toContain('# >>> hygiene');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('.tmp/');
    expect((await stat(path.join(root, '.tmp'))).isDirectory()).toBe(true);
    await expect(loadConfig(root, path.join(base, 'no.yml'))).resolves.toBeDefined();
  });

  it('una segunda ejecucion no cambia nada', async () => {
    await runInit({ root, home });
    const again = await runInit({ root, home });
    expect(again.filter((a) => a.status === 'created' || a.status === 'updated')).toEqual([]);
  });

  it('conserva un .gitignore existente y anade el bloque', async () => {
    await writeFile(path.join(root, '.gitignore'), 'mio/\n');
    const actions = await runInit({ root, home });
    expect(status(actions)['.gitignore']).toBe('updated');
    const gi = await leer('.gitignore');
    expect(gi.startsWith('mio/\n')).toBe(true);
    expect(gi).toContain('node_modules/');
  });

  it('inyecta las reglas para agentes en el fichero de instrucciones existente', async () => {
    await writeFile(path.join(root, 'CLAUDE.md'), '# Proyecto\n');
    const actions = await runInit({ root, home });
    expect(status(actions)['CLAUDE.md']).toBe('updated');
    const md = await leer('CLAUDE.md');
    expect(md.startsWith('# Proyecto\n')).toBe(true);
    expect(md).toContain('<!-- >>> hygiene -->');
    expect(md).toContain('hygiene approve');
  });

  it('no crea un fichero de instrucciones si no hay ninguno', async () => {
    const actions = await runInit({ root, home });
    expect(actions.find((a) => a.file === 'CLAUDE.md')).toMatchObject({ status: 'skipped' });
  });

  it('cada edicion se puede deshacer con restore', async () => {
    await writeFile(path.join(root, '.gitignore'), 'mio/\n');
    const actions = await runInit({ root, home });
    const entry = actions.find((a) => a.file === '.gitignore')?.entry;
    expect(entry).toBeDefined();
    const [e] = await findEntries(home, entry!);
    expect(await restoreEntry(e!)).toMatchObject({ status: 'restored' });
    expect(await leer('.gitignore')).toBe('mio/\n');
  });
});
