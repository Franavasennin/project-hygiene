import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AuditResult, FileEntry, Inventory } from './core/types.js';
import { Budget, DEFAULT_LIMITS, type Limits } from './core/limits.js';
import { detectProjects } from './detector/detect.js';
import { walk } from './collectors/filesystem.js';
import { collectGit } from './collectors/git.js';
import { createContentCache, type ContentCache } from './collectors/content.js';
import { loadPacks } from './rules/schema.js';
import { evaluateAll } from './engine/evaluate.js';
import type { EvalContext } from './engine/predicates.js';
import { computeScore } from './scorer/score.js';

export interface AuditOptions {
  root: string;
  rulesDir: string;
  limits?: Partial<Limits>;
}

const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.py', '.md', '.yml', '.yaml',
]);

async function findReferences(files: FileEntry[], budget: Budget): Promise<Set<string>> {
  const candidates = files.filter((f) => !f.isDir);
  const names = new Map<string, string[]>();
  for (const f of candidates) {
    const base = f.path.split('/').pop() ?? f.path;
    const list = names.get(base) ?? [];
    list.push(f.path);
    names.set(base, list);
  }

  const referenced = new Set<string>();
  let scanned = 0;
  for (const f of candidates) {
    if (scanned >= budget.limits.maxReferenceSearchFiles) {
      budget.note('maxReferenceSearchFiles');
      break;
    }
    if (!SOURCE_EXT.has(path.extname(f.path))) continue;
    if (f.size > budget.limits.maxFileSizeForContentScan) continue;
    scanned += 1;

    let text: string;
    try {
      text = await readFile(f.absPath, 'utf8');
    } catch {
      continue;
    }
    for (const [base, paths] of names) {
      if (base.length < 4) continue;
      if (!text.includes(base)) continue;
      for (const p of paths) if (p !== f.path) referenced.add(p);
    }
  }
  return referenced;
}

async function duplicateHashes(files: FileEntry[], content: ContentCache): Promise<Set<string>> {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.isDir) continue;
    const h = await content.hash(f);
    if (!h) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([h]) => h));
}

export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  const budget = new Budget({ ...DEFAULT_LIMITS, ...options.limits });

  // walk() tambien devuelve `unreadable: string[]` (rutas que no se pudieron
  // leer durante el recorrido). El tipo `Inventory` de core/types.ts no tiene
  // un campo para eso -- solo tiene `truncated`, no `unreadable` -- asi que
  // aqui se descarta deliberadamente. Exponerlo en el inventario queda para
  // una tarea futura si se decide que el resto del pipeline lo necesita.
  const { files, truncated } = await walk(options.root, budget);
  const projects = await detectProjects(options.root);
  // collectGit(cwd) devuelve los GitFacts del repo que contiene `cwd` (o un
  // GitFacts "vacio" con isRepo=false si no hay repo). No hay un concepto de
  // "por proyecto" en la firma real; se usa una unica clave '.' cuando el
  // root es un repo, igual que en el diseno de referencia.
  const git = await collectGit(options.root);

  const inventory: Inventory = {
    root: options.root,
    scannedAt: new Date().toISOString(),
    truncated,
    files,
    projects,
    gitByProject: git.isRepo ? { '.': git } : {},
  };

  const content = createContentCache(budget);
  const duplicates = await duplicateHashes(files, content);
  const referenced = await findReferences(files, budget);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const now = Date.now();

  const makeContext = (p: string): EvalContext => {
    const entry = byPath.get(p);
    if (!entry) throw new Error(`entrada desconocida: ${p}`);
    return {
      entry,
      git: git.isRepo ? git : null,
      content,
      duplicateHashes: duplicates,
      referencedPaths: referenced,
      now,
    };
  };

  const packs = await loadPacks(options.rulesDir);
  const { findings, limits } = await evaluateAll({ inventory, packs, budget, makeContext });
  const score = computeScore(findings, limits);

  return { inventory, findings, limits, score };
}
