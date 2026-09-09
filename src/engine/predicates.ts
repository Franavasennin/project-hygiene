import picomatch from 'picomatch';
import type { FileEntry, GitFacts } from '../core/types.js';
import { compile } from '../rules/regex-guard.js';
import { shannonEntropy } from '../collectors/content.js';

export interface EvalContext {
  entry: FileEntry;
  git: GitFacts | null;
  content: {
    text(entry: FileEntry): Promise<string | null>;
    hash(entry: FileEntry): Promise<string | null>;
  };
  duplicateHashes: Set<string>;
  referencedPaths: Set<string>;
  now: number;
}

export class UnknownPredicateError extends Error {}

const matcherCache = new Map<string, (s: string) => boolean>();
const regexCache = new Map<string, RegExp>();

function glob(pattern: string): (s: string) => boolean {
  let m = matcherCache.get(pattern);
  if (!m) {
    m = picomatch(pattern, { dot: true });
    matcherCache.set(pattern, m);
  }
  return m;
}

function regex(pattern: string): RegExp {
  let r = regexCache.get(pattern);
  if (!r) {
    r = compile(pattern);
    regexCache.set(pattern, r);
  }
  return r;
}

function durationMs(spec: string): number {
  const n = Number(spec.slice(0, -1));
  const unit = spec.at(-1);
  if (unit === 'd') return n * 86_400_000;
  if (unit === 'h') return n * 3_600_000;
  return n * 60_000;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * Evalua un unico predicado con nombre contra el contexto de un fichero.
 *
 * Contrato de confianza: `value` llega aqui ya validado por el JSON Schema
 * de rules/pack.schema.json (ver src/rules/schema.ts). El schema garantiza
 * el tipo de cada predicado -- boolean para is_file/is_dir/tracked_by_git/etc,
 * enum para git_status, integer para depth_gt/size_gt/size_lt, un patron
 * `\d+[dhm]` para older_than/newer_than. Este modulo asume esa garantia y
 * no revalida tipos: hacerlo duplicaria una comprobacion que ya ocurre en
 * la capa de carga de packs. Si algun dia `evalPredicate` se expone a
 * entrada que NO paso por ese schema, esta asuncion deja de sostenerse.
 */
export async function evalPredicate(
  name: string,
  value: unknown,
  ctx: EvalContext,
): Promise<boolean> {
  const e = ctx.entry;

  switch (name) {
    case 'glob':
      return glob(String(value))(e.path);
    case 'path_regex':
      return regex(String(value)).test(e.path);
    case 'basename_regex':
      return regex(String(value)).test(basename(e.path));
    case 'depth_gt':
      return e.depth > Number(value);
    case 'is_file':
      return !e.isDir === Boolean(value);
    case 'is_dir':
      return e.isDir === Boolean(value);
    case 'is_symlink':
      return e.isSymlink === Boolean(value);
    case 'is_empty':
      return (e.size === 0) === Boolean(value);
    case 'size_gt':
      return e.size > Number(value);
    case 'size_lt':
      return e.size < Number(value);
    case 'older_than':
      return ctx.now - e.mtimeMs > durationMs(String(value));
    case 'newer_than':
      return ctx.now - e.mtimeMs < durationMs(String(value));
    case 'tracked_by_git':
      return (ctx.git?.trackedFiles.has(e.path) ?? false) === Boolean(value);
    case 'ignored_by_git':
      return (ctx.git?.ignoredFiles.has(e.path) ?? false) === Boolean(value);
    case 'git_status': {
      const dirty = ctx.git?.dirtyFiles.has(e.path) ?? false;
      return value === 'dirty' ? dirty : !dirty;
    }
    case 'content_matches': {
      const text = await ctx.content.text(e);
      return text !== null && regex(String(value)).test(text);
    }
    case 'entropy_gt': {
      const text = await ctx.content.text(e);
      if (text === null) return false;
      const best = text
        .split(/[\s"'`,;]+/)
        .filter((t) => t.length >= 16)
        .reduce((max, t) => Math.max(max, shannonEntropy(t)), shannonEntropy(text));
      return best > Number(value);
    }
    case 'sha256_duplicate': {
      const h = await ctx.content.hash(e);
      return (h !== null && ctx.duplicateHashes.has(h)) === Boolean(value);
    }
    case 'referenced_by_source':
      return ctx.referencedPaths.has(e.path) === Boolean(value);
    default:
      throw new UnknownPredicateError(`predicado desconocido: ${name}`);
  }
}
