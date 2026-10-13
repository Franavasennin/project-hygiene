import { stat } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import type { FileEntry, GitFacts, ProjectCandidate } from '../core/types.js';
import { compile } from '../rules/regex-guard.js';
import { shannonEntropy } from '../collectors/content.js';

export interface WorkspaceFacts {
  projects: ProjectCandidate[];
  /** El root no es proyecto y contiene al menos un proyecto (spec §2). */
  rootIsWorkspace: boolean;
  /** Numero de hijos directos inventariados por directorio ('.' es el root). */
  childCounts: Map<string, number>;
  entryAt(path: string): FileEntry | undefined;
}

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
  /** Opcional para que los tests de predicados de fichero no lo necesiten. */
  workspace?: WorkspaceFacts;
  /** Inyectable en tests; por defecto process.platform. */
  platform?: NodeJS.Platform;
}

export class UnknownPredicateError extends Error {}

/** Un predicado no pudo concluir dentro de su presupuesto (NN-1). */
export class RuleLimitError extends Error {
  constructor(readonly limit: string) {
    super(`limite alcanzado: ${limit}`);
  }
}

/** La plataforma no permite evaluar el predicado. Se reporta, no se finge. */
export class UnsupportedPredicateError extends Error {}

function childPath(dir: string, name: string): string {
  return dir === '.' ? name : `${dir}/${name}`;
}

function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : p.slice(0, i);
}

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) out.add(words.slice(i, i + 3).join(' '));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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
    case 'is_empty': {
      // Un directorio esta vacio si no tiene hijos inventariados; su tamano
      // no significa nada (4096 en Linux, 0 en Windows).
      const empty = e.isDir && ctx.workspace
        ? !e.notDescended && (ctx.workspace.childCounts.get(e.path) ?? 0) === 0
        : e.size === 0;
      return empty === Boolean(value);
    }
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
    case 'ignored_by_git': {
      const ignored = e.isDir
        ? (ctx.git?.ignoredDirs?.has(e.path) ?? false)
        : (ctx.git?.ignoredFiles.has(e.path) ?? false);
      return ignored === Boolean(value);
    }
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
      // Un secreto usa el alfabeto base64/hex/alfanumerico (mas - _ + / =).
      // Partir por cualquier otro caracter evita que una expresion de codigo
      // pegada, como `(a.indexOf(b.c)`, cuente como un token de alta entropia.
      const tokens = text.split(/[^A-Za-z0-9+/=_-]+/).filter((t) => t.length >= 16);
      if (tokens.length === 0) return false;
      const best = tokens.reduce((max, t) => Math.max(max, shannonEntropy(t)), 0);
      return best > Number(value);
    }
    case 'sha256_duplicate': {
      const h = await ctx.content.hash(e);
      return (h !== null && ctx.duplicateHashes.has(h)) === Boolean(value);
    }
    case 'referenced_by_source':
      return ctx.referencedPaths.has(e.path) === Boolean(value);
    case 'in_project': {
      const inside = ctx.workspace?.projects.some((c) => c.status === 'project'
        && (c.path === '.' || e.path === c.path || e.path.startsWith(`${c.path}/`))) ?? false;
      return inside === Boolean(value);
    }
    case 'root_is_workspace':
      return (ctx.workspace?.rootIsWorkspace ?? false) === Boolean(value);
    case 'in_git_repo':
      return (ctx.git?.isRepo ?? false) === Boolean(value);
    case 'mode_too_open': {
      if ((ctx.platform ?? process.platform) === 'win32') {
        throw new UnsupportedPredicateError('los permisos POSIX no existen en Windows');
      }
      const open = e.mode !== undefined && (e.mode & 0o077) !== 0;
      return open === Boolean(value);
    }
    case 'similar_to_readme_gt': {
      const ws = ctx.workspace;
      if (!ws || e.isDir) return false;
      const readme = ws.entryAt(childPath(parentDir(e.path), 'README.md'));
      if (!readme || readme.path === e.path) return false;
      const a = await ctx.content.text(e);
      const b = await ctx.content.text(readme);
      if (a === null || b === null) return false;
      return jaccard(shingles(a), shingles(b)) > Number(value);
    }
    case 'project_status':
      return ctx.workspace?.projects.find((c) => c.path === e.path)?.status === value;
    case 'has_child': {
      const ws = ctx.workspace;
      if (!ws) return false;
      return (value as string[]).some((name) => ws.entryAt(childPath(e.path, name)) !== undefined);
    }
    case 'is_git_repo':
      return (ctx.workspace?.entryAt(childPath(e.path, '.git'))?.isDir ?? false) === Boolean(value);
    case 'git_worktree_orphan': {
      const dotgit = ctx.workspace?.entryAt(childPath(e.path, '.git'));
      let orphan = false;
      if (dotgit && !dotgit.isDir) {
        const m = (await ctx.content.text(dotgit))?.match(/^gitdir:\s*(.+)$/m);
        if (m?.[1]) orphan = !(await exists(path.resolve(path.dirname(dotgit.absPath), m[1].trim())));
      }
      return orphan === Boolean(value);
    }
    case 'git_stash_older_than': {
      const limit = durationMs(String(value));
      return (ctx.git?.stashTimesMs ?? []).some((t) => ctx.now - t > limit);
    }
    case 'git_branch_stale':
    case 'git_branch_orphaned': {
      const g = ctx.git;
      if (!g?.defaultBranch || !g.branches) return false;
      const limit = durationMs(String(value));
      return g.branches.some((b) => b.name !== g.defaultBranch
        && ctx.now - b.lastCommitMs > limit
        && (name === 'git_branch_stale'
          ? b.upstream !== null && b.merged
          : b.upstream === null && !b.merged));
    }
    case 'in_git_history': {
      const spec = value as { paths: string[]; except?: string[] };
      const g = ctx.git;
      if (!g?.historyPaths) return false;
      const match = picomatch(spec.paths, { dot: true, ignore: spec.except ?? [] });
      for (const p of g.historyPaths) if (match(p)) return true;
      if (g.historyTruncated) throw new RuleLimitError('max_git_history_commits');
      return false;
    }
    default:
      throw new UnknownPredicateError(`predicado desconocido: ${name}`);
  }
}
