import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * sha256 hexadecimal de un fichero, leido en streaming. Mismo formato que
 * collectors/content.ts, asi que las huellas del plan y del executor se
 * comparan directamente.
 */
export async function hashFile(absPath: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(absPath)) h.update(chunk as Buffer);
  return h.digest('hex');
}
