import { constants, copyFile, rename, unlink } from 'node:fs/promises';
import { hashFile } from './hash.js';

export interface MoveDeps {
  rename(from: string, to: string): Promise<void>;
}

const DEFAULT_DEPS: MoveDeps = { rename };

export class MoveVerificationError extends Error {}

/**
 * Mueve un fichero. Intenta rename, que es atomico en el mismo volumen. Si
 * origen y destino estan en volumenes distintos (EXDEV), copia sin
 * sobrescribir, verifica el hash de la copia y solo entonces borra el origen.
 * Si la verificacion falla, borra la copia y deja el origen como estaba.
 */
export async function moveFile(
  from: string,
  to: string,
  expectedSha256: string,
  deps: MoveDeps = DEFAULT_DEPS,
): Promise<void> {
  try {
    await deps.rename(from, to);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
  }

  await copyFile(from, to, constants.COPYFILE_EXCL);
  const copied = await hashFile(to);
  if (copied !== expectedSha256) {
    await unlink(to);
    throw new MoveVerificationError(`la copia de ${from} no coincide con el hash esperado; el origen no se ha tocado`);
  }
  await unlink(from);
}
