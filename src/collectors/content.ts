import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { FileEntry } from '../core/types.js';
import type { Budget } from '../core/limits.js';

export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Huella corta para reportar un secreto sin exponerlo. */
export function fingerprint(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex').slice(0, 16)}`;
}

export interface ContentCache {
  text(entry: FileEntry): Promise<string | null>;
  hash(entry: FileEntry): Promise<string | null>;
}

export function createContentCache(budget: Budget): ContentCache {
  const texts = new Map<string, string | null>();
  const hashes = new Map<string, string | null>();

  async function load(entry: FileEntry): Promise<Buffer | null> {
    if (entry.isDir) return null;
    if (entry.size > budget.limits.maxFileSizeForContentScan) {
      budget.note('maxFileSizeForContentScan');
      return null;
    }
    try {
      return await readFile(entry.absPath);
    } catch {
      return null;
    }
  }

  return {
    async text(entry) {
      if (texts.has(entry.path)) return texts.get(entry.path) ?? null;
      const buf = await load(entry);
      const value = buf && !looksBinary(buf)
        ? buf.toString('utf8').slice(0, budget.limits.maxRegexInputLength)
        : null;
      texts.set(entry.path, value);
      return value;
    },
    async hash(entry) {
      if (hashes.has(entry.path)) return hashes.get(entry.path) ?? null;
      const buf = await load(entry);
      const value = buf ? sha256(buf) : null;
      hashes.set(entry.path, value);
      return value;
    },
  };
}
