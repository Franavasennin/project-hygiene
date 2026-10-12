import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashFile } from '../../src/executor/hash.js';
import { moveFile, MoveVerificationError } from '../../src/executor/move.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const existe = (p: string) => access(p).then(() => true, () => false);
const exdev = async (): Promise<void> => {
  throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
};

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'hyg-mv-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('hashFile', () => {
  it('coincide con el sha256 del contenido', async () => {
    const p = path.join(dir, 'a.txt');
    await writeFile(p, 'hola');
    expect(await hashFile(p)).toBe(sha('hola'));
  });
});

describe('moveFile', () => {
  it('mueve con rename en el mismo volumen', async () => {
    const from = path.join(dir, 'a.txt');
    const to = path.join(dir, 'b.txt');
    await writeFile(from, 'hola');
    await moveFile(from, to, sha('hola'));
    expect(await existe(from)).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('hola');
  });

  it('entre volumenes copia, verifica y solo entonces borra el origen', async () => {
    const from = path.join(dir, 'a.txt');
    const to = path.join(dir, 'b.txt');
    await writeFile(from, 'hola');
    await moveFile(from, to, sha('hola'), { rename: exdev });
    expect(await existe(from)).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('hola');
  });

  it('si la copia no verifica, deja el origen intacto y no deja copia', async () => {
    const from = path.join(dir, 'a.txt');
    const to = path.join(dir, 'b.txt');
    await writeFile(from, 'hola');
    await expect(moveFile(from, to, sha('otra cosa'), { rename: exdev }))
      .rejects.toBeInstanceOf(MoveVerificationError);
    expect(await readFile(from, 'utf8')).toBe('hola');
    expect(await existe(to)).toBe(false);
  });

  it('propaga cualquier otro error de rename sin tocar el origen', async () => {
    const from = path.join(dir, 'a.txt');
    await writeFile(from, 'hola');
    await expect(moveFile(from, path.join(dir, 'no', 'existe', 'b.txt'), sha('hola')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await existe(from)).toBe(true);
  });
});
