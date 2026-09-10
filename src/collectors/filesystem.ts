import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry } from '../core/types.js';
import type { Budget } from '../core/limits.js';

/** Directorios que se registran pero no se recorren. */
export const GENERATED_DIRS = new Set([
  'node_modules', '.venv', 'venv', 'dist', 'build', 'target',
  '.next', '__pycache__', '.git', 'coverage',
]);

export interface WalkResult {
  files: FileEntry[];
  truncated: boolean;
  unreadable: string[];
}

/** Tope defensivo contra desbordamiento de pila en arboles patologicos. No es
 * parte del sistema de limites configurable: es una salvaguarda dura. */
const MAX_SAFE_DEPTH = 1000;

export async function walk(root: string, budget: Budget): Promise<WalkResult> {
  const files: FileEntry[] = [];
  const unreadable: string[] = [];
  let truncated = false;

  async function visit(absDir: string, relDir: string, depth: number): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = (await readdir(absDir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    } catch {
      if (relDir !== '') {
        unreadable.push(relDir);
      }
      return;
    }

    for (const e of entries) {
      if (truncated) return;
      const abs = path.join(absDir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;

      let st;
      try {
        st = await lstat(abs);
      } catch {
        unreadable.push(rel);
        continue;
      }

      if (!budget.consumeFile()) {
        truncated = true;
        return;
      }

      const isDir = st.isDirectory();
      const generated = isDir && GENERATED_DIRS.has(e.name);

      files.push({
        path: rel,
        absPath: abs,
        isDir,
        isSymlink: st.isSymbolicLink(),
        size: st.size,
        mtimeMs: st.mtimeMs,
        depth: depth + 1,
        notDescended: generated,
      });

      if (isDir && !generated && !st.isSymbolicLink() && depth + 1 < MAX_SAFE_DEPTH) {
        await visit(abs, rel, depth + 1);
      }
    }
  }

  await visit(root, '', 0);
  return { files, truncated, unreadable };
}
