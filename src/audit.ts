import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AuditResult, FileEntry, Inventory, ProjectCandidate } from './core/types.js';
import { Budget, DEFAULT_LIMITS, type Limits } from './core/limits.js';
import { detectProjects } from './detector/detect.js';
import { walk } from './collectors/filesystem.js';
import { collectGitByProject, countChildren, gitFor, isWorkspace } from './collectors/workspace.js';
import { createContentCache, type ContentCache } from './collectors/content.js';
import { loadPacks } from './rules/schema.js';
import { evaluateAll } from './engine/evaluate.js';
import type { EvalContext, WorkspaceFacts } from './engine/predicates.js';
import { computeScore } from './scorer/score.js';

export interface AuditOptions {
  root: string;
  rulesDir: string;
  limits?: Partial<Limits>;
  /** Rama por defecto configurada (`git.default_branch`). */
  defaultBranch?: string;
}

export interface AuditFacts {
  /** Rutas que algun fichero fuente menciona por su nombre. */
  referenced: Set<string>;
  /**
   * false si la busqueda de referencias no pudo examinarlo todo: tope agotado,
   * fichero fuente demasiado grande o ilegible, o inventario truncado. En ese
   * caso la ausencia de referencia no demuestra nada (spec §6).
   */
  referencesComplete: boolean;
  content: ContentCache;
}

export interface CollectedAudit {
  result: AuditResult;
  facts: AuditFacts;
}

const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.py', '.md', '.yml', '.yaml',
]);

interface ReferenceScan {
  referenced: Set<string>;
  /** false si algun fichero fuente no se pudo examinar. */
  complete: boolean;
}

async function findReferences(files: FileEntry[], budget: Budget): Promise<ReferenceScan> {
  const candidates = files.filter((f) => !f.isDir);
  const names = new Map<string, string[]>();
  for (const f of candidates) {
    const base = f.path.split('/').pop() ?? f.path;
    const list = names.get(base) ?? [];
    list.push(f.path);
    names.set(base, list);
  }

  const referenced = new Set<string>();
  let complete = true;
  let scanned = 0;
  for (const f of candidates) {
    if (!SOURCE_EXT.has(path.extname(f.path))) continue;
    // Un symlink no se sigue: readFile leeria el destino, que puede estar
    // fuera del arbol y saltarse el tope de tamano (mismo criterio que
    // collectors/content.ts). Es un fichero fuente sin examinar, asi que las
    // referencias quedan incompletas (decision 9: lo desconocido no se toca).
    if (f.isSymlink) {
      complete = false;
      continue;
    }
    if (scanned >= budget.limits.maxReferenceSearchFiles) {
      budget.note('maxReferenceSearchFiles');
      complete = false;
      break;
    }
    if (f.size > budget.limits.maxFileSizeForContentScan) {
      complete = false;
      continue;
    }
    scanned += 1;

    let text: string;
    try {
      text = await readFile(f.absPath, 'utf8');
    } catch {
      complete = false;
      continue;
    }
    for (const [base, paths] of names) {
      if (base.length < 4) continue;
      if (!text.includes(base)) continue;
      for (const p of paths) if (p !== f.path) referenced.add(p);
    }
  }
  return { referenced, complete };
}

// Reutiliza maxReferenceSearchFiles como tope tambien para el escaneo de
// duplicados, en vez de anadir un limite dedicado a la interfaz Limits.
// Ambas operaciones son de la misma naturaleza (recorrer y leer contenido
// de una porcion acotada del arbol), asi que comparten presupuesto.
async function duplicateHashes(files: FileEntry[], content: ContentCache, budget: Budget): Promise<Set<string>> {
  const counts = new Map<string, number>();
  let scanned = 0;
  for (const f of files) {
    if (f.isDir) continue;
    if (scanned >= budget.limits.maxReferenceSearchFiles) {
      budget.note('maxReferenceSearchFiles');
      break;
    }
    scanned += 1;
    const h = await content.hash(f);
    if (!h) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([h]) => h));
}

export async function collectAudit(options: AuditOptions): Promise<CollectedAudit> {
  const budget = new Budget({ ...DEFAULT_LIMITS, ...options.limits });

  // walk() devuelve `unreadable` (rutas que no se pudieron leer). No hay campo
  // en `Inventory`, pero un directorio ilegible puede ocultar ficheros fuente,
  // asi que se usa para marcar las referencias como incompletas.
  const { files, truncated, unreadable } = await walk(options.root, budget);
  const projects: ProjectCandidate[] = await detectProjects(options.root);

  // El root no esta en el inventario; las reglas de proyecto lo necesitan
  // como entrada (candidato '.').
  const rootEntry: FileEntry = {
    path: '.', absPath: options.root, isDir: true, isSymlink: false,
    size: 0, mtimeMs: 0, depth: 0, notDescended: false,
  };
  const byPath = new Map<string, FileEntry>([['.', rootEntry], ...files.map((f) => [f.path, f] as const)]);

  const gitByProject = await collectGitByProject(options.root, projects, byPath, {
    defaultBranch: options.defaultBranch,
    maxHistoryCommits: budget.limits.maxGitHistoryCommits,
  });

  const inventory: Inventory = {
    root: options.root,
    scannedAt: new Date().toISOString(),
    truncated,
    files,
    projects,
    gitByProject,
  };

  const content = createContentCache(budget);
  const duplicates = await duplicateHashes(files, content, budget);
  const refs = await findReferences(files, budget);
  const now = Date.now();
  const workspace: WorkspaceFacts = {
    projects,
    rootIsWorkspace: isWorkspace(projects),
    childCounts: countChildren(files),
    entryAt: (p) => byPath.get(p),
  };

  // Si la ruta pedida no esta en el inventario recorrido (byPath), se degrada
  // con un FileEntry sintetico minimo en vez de lanzar una excepcion que
  // abortaria toda la auditoria. Esto es defensivo: hoy evaluateAll solo pide
  // rutas que vienen de inventory.files (por lo que este caso no deberia
  // ocurrir en el flujo actual), pero es la funcion publica mas importante
  // del sistema y no debe ser fragil ante un futuro cambio en quien llama a
  // makeContext.
  const makeContext = (p: string): EvalContext => {
    const entry = byPath.get(p) ?? {
      path: p,
      absPath: path.join(options.root, p),
      isDir: false,
      isSymlink: false,
      size: 0,
      mtimeMs: 0,
      depth: p.split('/').length,
      notDescended: false,
    };
    return {
      entry,
      git: gitFor(gitByProject, p),
      content,
      duplicateHashes: duplicates,
      referencedPaths: refs.referenced,
      now,
      workspace,
    };
  };

  const packs = await loadPacks(options.rulesDir);
  const projectEntries = projects
    .map((c) => byPath.get(c.path))
    .filter((e): e is FileEntry => e !== undefined);
  const { findings, limits, unsupported } = await evaluateAll({
    inventory, packs, budget, makeContext, projectEntries,
  });
  const score = computeScore(findings, limits);

  return {
    result: { inventory, findings, limits, score, unsupported },
    facts: {
      referenced: refs.referenced,
      referencesComplete: refs.complete && !truncated && unreadable.length === 0,
      content,
    },
  };
}

export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  return (await collectAudit(options)).result;
}
