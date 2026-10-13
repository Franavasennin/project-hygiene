import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyEdit, fingerprintText, ABSENT } from '../../src/executor/edit.js';
import { findEntries, readManifest } from '../../src/executor/manifest.js';
import { restoreEntry } from '../../src/executor/restore.js';
import { HomeInsideWorkspaceError } from '../../src/core/home.js';

const DIA = new Date('2026-10-12T10:00:00.000Z');
const existe = (p: string) => access(p).then(() => true, () => false);
let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-ed-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const append = (line: string) => (cur: string | null) => `${cur ?? ''}${line}\n`;
const edit = (extra: Partial<Parameters<typeof applyEdit>[0]> = {}) => applyEdit({
  root, home, opId: 'OP-000001', file: '.gitignore', transform: append('/dist/'),
  ruleIds: ['FS-GENERATED-001'], reason: 'r', now: DIA, ...extra,
});

describe('applyEdit', () => {
  it('crea el fichero si no existe y lo registra como edicion', async () => {
    const r = await edit();
    expect(r).toMatchObject({ status: 'applied', created: true, entry: '2026-10-12/OP-000001' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('/dist/\n');
    const m = await readManifest(path.join(home, 'quarantine', '2026-10-12', 'OP-000001'));
    expect(m).toMatchObject({ kind: 'edit', state: 'quarantined', edit: { before_sha256: null, after_sha256: fingerprintText('/dist/\n') } });
  });

  it('guarda una copia del original antes de modificar', async () => {
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    const r = await edit();
    expect(r).toMatchObject({ status: 'applied', created: false });
    const m = await readManifest(path.join(home, 'quarantine', '2026-10-12', 'OP-000001'));
    expect(await readFile(m.quarantine_path, 'utf8')).toBe('node_modules/\n');
  });

  it('no registra nada si la transformacion no cambia el fichero', async () => {
    await writeFile(path.join(root, '.gitignore'), 'x\n');
    expect(await edit({ transform: (c) => c ?? '' })).toMatchObject({ status: 'unchanged' });
    expect(await existe(path.join(home, 'quarantine'))).toBe(false);
  });

  it('omite la edicion si el fichero cambio desde la aprobacion', async () => {
    await writeFile(path.join(root, '.gitignore'), 'otro\n');
    expect(await edit({ expectedBefore: ABSENT })).toMatchObject({ status: 'skipped' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('otro\n');
  });

  it('se niega si la base cae dentro del workspace', async () => {
    await expect(edit({ home: path.join(root, '.hygiene') })).rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });
});

describe('restore de una edicion', () => {
  it('devuelve el contenido original', async () => {
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    await edit();
    const [e] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(e!)).toMatchObject({ status: 'restored' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
  });

  it('un fichero creado por hygiene se aparta a la entrada, no se borra', async () => {
    await edit();
    const [e] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(e!)).toMatchObject({ status: 'restored' });
    expect(await existe(path.join(root, '.gitignore'))).toBe(false);
    expect(await readFile(path.join(e!.dir, 'created', '.gitignore'), 'utf8')).toBe('/dist/\n');
  });

  it('aborta sin tocar nada si el fichero cambio despues de la edicion', async () => {
    await edit();
    await writeFile(path.join(root, '.gitignore'), 'editado a mano\n');
    const [e] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(e!)).toMatchObject({ status: 'aborted' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('editado a mano\n');
  });

  it('las entradas INIT- se encuentran por su referencia', async () => {
    await edit({ opId: 'INIT-000001' });
    expect((await findEntries(home, 'INIT-000001')).map((e) => e.entry)).toEqual(['2026-10-12/INIT-000001']);
  });
});
