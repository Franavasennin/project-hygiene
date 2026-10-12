import path from 'node:path';
import type { FileEntry, GitFacts, ProjectCandidate } from '../core/types.js';
import { collectGit, type GitOptions } from './git.js';

export function isWorkspace(projects: ProjectCandidate[]): boolean {
  const self = projects.find((c) => c.path === '.');
  return self?.status !== 'project'
    && projects.some((c) => c.path !== '.' && c.status === 'project');
}

export function countChildren(files: FileEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const i = f.path.lastIndexOf('/');
    const parent = i === -1 ? '.' : f.path.slice(0, i);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

/** Lleva las rutas de un repo hijo al espacio de rutas del root auditado. */
export function prefixGitFacts(g: GitFacts, prefix: string): GitFacts {
  const add = (s: Set<string>) => new Set([...s].map((p) => `${prefix}/${p}`));
  return {
    ...g,
    trackedFiles: add(g.trackedFiles),
    ignoredFiles: add(g.ignoredFiles),
    dirtyFiles: add(g.dirtyFiles),
    ignoredDirs: g.ignoredDirs ? add(g.ignoredDirs) : undefined,
  };
}

/** Clave del repo mas interior que contiene la ruta, o null. */
export function gitKeyFor(byProject: Record<string, GitFacts>, p: string): string | null {
  const rank = (k: string) => (k === '.' ? 0 : k.length);
  let best: string | null = null;
  for (const k of Object.keys(byProject)) {
    const inside = k === '.' || p === k || p.startsWith(`${k}/`);
    if (inside && (best === null || rank(k) > rank(best))) best = k;
  }
  return best;
}

export function gitFor(byProject: Record<string, GitFacts>, p: string): GitFacts | null {
  const key = gitKeyFor(byProject, p);
  return key === null ? null : byProject[key] ?? null;
}

/**
 * Hechos de git del root (si esta dentro de un repo) y de cada candidato
 * hijo con su propio .git. Un hijo que es el mismo repo que el root no se
 * duplica.
 */
export async function collectGitByProject(
  root: string,
  projects: ProjectCandidate[],
  byPath: Map<string, FileEntry>,
  opts: GitOptions,
): Promise<Record<string, GitFacts>> {
  const out: Record<string, GitFacts> = {};
  const rootGit = await collectGit(root, opts);
  if (rootGit.isRepo) out['.'] = rootGit;
  for (const c of projects) {
    if (c.path === '.' || !byPath.has(`${c.path}/.git`)) continue;
    const g = await collectGit(path.join(root, c.path), opts);
    if (g.isRepo && g.root !== rootGit.root) out[c.path] = prefixGitFacts(g, c.path);
  }
  return out;
}
