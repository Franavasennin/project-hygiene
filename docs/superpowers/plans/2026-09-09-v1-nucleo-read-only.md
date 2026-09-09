# project-hygiene v1, plan 1 de 3: núcleo de solo lectura

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** construir la mitad de solo lectura de la herramienta, de modo que
`hygiene scan`, `hygiene audit` y `hygiene explain` funcionen sobre un workspace
real sin escribir un solo byte fuera de la salida estándar.

**Architecture:** tubería de cinco etapas. El detector clasifica directorios por
señales con confianza. Los collectors leen disco y Git y producen un inventario
JSON sin juzgar. El motor evalúa ese inventario contra packs YAML validados por
JSON Schema y bajo presupuesto de ejecución. El scorer agrega. La CLI imprime.
El motor no conoce ninguna regla concreta: toda la política vive en `rules/`.

**Tech Stack:** TypeScript 5 estricto sobre Node 20+, ESM. Vitest para tests.
Tres dependencias de ejecución: `yaml` para parsear packs, `ajv` para validar el
schema, `picomatch` para globs. Git se invoca como proceso, sin dependencia.

**Fuera de este plan:** planner, aprobación, executor, cuarentena, `restore`,
`init`, `loop`, y el predicado `in_git_history`. Van en los planes 2 y 3.

**Referencia:** `docs/superpowers/specs/2026-09-09-project-hygiene-design.md`.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/core/types.ts` | Tipos compartidos. Sin lógica. |
| `src/core/limits.ts` | Presupuesto de ejecución y reloj de fecha límite. |
| `src/detector/detect.ts` | Señales, confianza y clasificación de directorios. |
| `src/collectors/filesystem.ts` | Recorrido del árbol con topes. |
| `src/collectors/git.ts` | Hechos de Git por proyecto. |
| `src/collectors/content.ts` | Lectura acotada de texto, hash y entropía. |
| `src/rules/schema.ts` | Carga y validación estricta de packs. |
| `src/rules/regex-guard.ts` | Rechazo estático de patrones peligrosos. |
| `src/engine/predicates.ts` | Un predicado por nombre. Nada más. |
| `src/engine/evaluate.ts` | Recorre el árbol `match` y produce hallazgos. |
| `src/scorer/score.ts` | Fórmula de puntuación y bloqueadores. |
| `src/report/human.ts` | Salida de tabla para persona. |
| `src/audit.ts` | Orquestador de la tubería completa. |
| `src/cli/index.ts` | Parseo de argumentos y códigos de salida. |
| `rules/*.yml` | Los cuatro packs. |
| `rules/pack.schema.json` | El contrato de un pack. |

---

## Task 1: Andamiaje del proyecto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/core/version.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "project-hygiene",
  "version": "0.1.0",
  "description": "Audits and organizes software projects and AI-assisted development environments.",
  "license": "Apache-2.0",
  "type": "module",
  "bin": { "hygiene": "./dist/cli/index.js" },
  "engines": { "node": ">=20" },
  "files": ["dist", "rules"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "picomatch": "^4.0.2",
    "yaml": "^2.5.1"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@types/picomatch": "^3.0.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Con `module: Node16` y `type: module`, **todo import relativo lleva extensión
`.js`**, aunque el fichero fuente sea `.ts`. Se respeta en todo el plan.

- [ ] **Step 3: Crear `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Crear `src/core/version.ts` y el test de humo**

```ts
// src/core/version.ts
export const ENGINE_VERSION = '0.1.0';
export const SCORE_PROFILE = 'v1-core' as const;
```

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION, SCORE_PROFILE } from '../src/core/version.js';

describe('andamiaje', () => {
  it('expone version de motor y perfil de score', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
    expect(SCORE_PROFILE).toBe('v1-core');
  });
});
```

- [ ] **Step 5: Instalar, comprobar y commitear**

Ejecutar: `npm install && npm run typecheck && npm test`
Esperado: typecheck sin errores, un test pasando.

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src tests
git commit -m "chore: andamiaje TypeScript con vitest"
```

---

## Task 2: Tipos del núcleo

**Files:**
- Create: `src/core/types.ts`
- Test: no lleva test propio; lo ejercitan las tareas siguientes.

- [ ] **Step 1: Escribir `src/core/types.ts` completo**

```ts
export type Axis = 'filesystem' | 'git' | 'security' | 'ai';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type Risk = 'safe' | 'low' | 'medium' | 'high' | 'unknown';
export type SuggestionType =
  | 'quarantine' | 'ignore' | 'move' | 'create' | 'review' | 'none';

export interface FileEntry {
  /** Ruta relativa al root escaneado, siempre con separador '/'. */
  path: string;
  absPath: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
  depth: number;
  /** true si es un directorio generado cuyo contenido no se recorrió. */
  notDescended: boolean;
}

export type ProjectStatus = 'project' | 'unknown-boundary' | 'not-project';

export interface ProjectCandidate {
  path: string;
  confidence: number;
  markers: string[];
  status: ProjectStatus;
}

export interface GitFacts {
  isRepo: boolean;
  root: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  trackedFiles: Set<string>;
  ignoredFiles: Set<string>;
  dirtyFiles: Set<string>;
  stashCount: number;
}

export interface Inventory {
  root: string;
  scannedAt: string;
  truncated: boolean;
  files: FileEntry[];
  projects: ProjectCandidate[];
  gitByProject: Record<string, GitFacts>;
}

export interface Finding {
  id: string;
  ruleId: string;
  axis: Axis;
  path: string;
  severity: Severity;
  risk: Risk;
  confidence: number;
  reason: string;
  evidence: Record<string, unknown>;
  suggests: SuggestionType[];
}

export interface LimitHit {
  ruleId: string;
  limit: string;
}

export interface Score {
  profile: string;
  engineVersion: string;
  total: number;
  axes: Record<Axis, number>;
  clean: boolean;
  blockers: string[];
}

export interface AuditResult {
  inventory: Inventory;
  findings: Finding[];
  limits: LimitHit[];
  score: Score;
}
```

- [ ] **Step 2: Comprobar que compila**

Ejecutar: `npm run typecheck`
Esperado: sin errores.

- [ ] **Step 3: Commitear**

```bash
git add src/core/types.ts
git commit -m "feat: tipos del nucleo"
```

---

## Task 3: Presupuesto de ejecución

**Files:**
- Create: `src/core/limits.ts`
- Test: `tests/core/limits.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/core/limits.test.ts
import { describe, it, expect } from 'vitest';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';

describe('Budget', () => {
  it('agota el contador de ficheros y lo reporta', () => {
    const b = new Budget({ ...DEFAULT_LIMITS, maxFilesScanned: 2 });
    expect(b.consumeFile()).toBe(true);
    expect(b.consumeFile()).toBe(true);
    expect(b.consumeFile()).toBe(false);
    expect(b.hits()).toContain('maxFilesScanned');
  });

  it('detecta la fecha limite por regla', () => {
    const b = new Budget({ ...DEFAULT_LIMITS, timeoutMsPerRule: 0 });
    b.startRule('FS-TEMP-001');
    expect(b.ruleExpired()).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/core/limits.test.ts`
Esperado: FAIL, no encuentra el módulo `limits.js`.

- [ ] **Step 3: Implementar `src/core/limits.ts`**

```ts
export interface Limits {
  maxFilesScanned: number;
  maxFileSizeForContentScan: number;
  maxRuleMatches: number;
  maxReferenceSearchFiles: number;
  maxMatchTreeNodes: number;
  maxRegexInputLength: number;
  timeoutMsPerRule: number;
  timeoutMsTotal: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxFilesScanned: 200_000,
  maxFileSizeForContentScan: 2 * 1024 * 1024,
  maxRuleMatches: 5_000,
  maxReferenceSearchFiles: 20_000,
  maxMatchTreeNodes: 256,
  maxRegexInputLength: 256 * 1024,
  timeoutMsPerRule: 5_000,
  timeoutMsTotal: 300_000,
};

export class Budget {
  private files = 0;
  private ruleDeadline = Infinity;
  private ruleId: string | null = null;
  private readonly startedAt = Date.now();
  private readonly seen = new Set<string>();

  constructor(readonly limits: Limits) {}

  consumeFile(): boolean {
    if (this.files >= this.limits.maxFilesScanned) {
      this.seen.add('maxFilesScanned');
      return false;
    }
    this.files += 1;
    return true;
  }

  startRule(ruleId: string): void {
    this.ruleId = ruleId;
    this.ruleDeadline = Date.now() + this.limits.timeoutMsPerRule;
  }

  ruleExpired(): boolean {
    const expired = Date.now() >= this.ruleDeadline;
    if (expired && this.ruleId) this.seen.add('timeoutMsPerRule');
    return expired;
  }

  totalExpired(): boolean {
    const expired = Date.now() - this.startedAt >= this.limits.timeoutMsTotal;
    if (expired) this.seen.add('timeoutMsTotal');
    return expired;
  }

  note(limit: keyof Limits): void {
    this.seen.add(limit);
  }

  hits(): string[] {
    return [...this.seen];
  }
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/core/limits.test.ts`
Esperado: PASS, dos tests.

- [ ] **Step 5: Commitear**

```bash
git add src/core/limits.ts tests/core/limits.test.ts
git commit -m "feat: presupuesto de ejecucion del motor"
```

---

## Task 4: Project Detector

**Files:**
- Create: `src/detector/detect.ts`
- Test: `tests/detector/detect.test.ts`

Pesos acordados, con tope en 1,0:

| Señal | Peso |
|---|---|
| `.git` | 0.80 |
| Manifiesto (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `composer.json`) | 0.50 |
| `src/` y `tests/` juntos | 0.20 |
| README | 0.05 |

Umbrales: `>= 0.75` proyecto, `>= 0.40` frontera desconocida, resto no proyecto.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/detector/detect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectProjects } from '../../src/detector/detect.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const touch = async (p: string) => {
  await mkdir(path.dirname(path.join(root, p)), { recursive: true });
  await writeFile(path.join(root, p), '');
};

describe('detectProjects', () => {
  it('un directorio con .git es proyecto', async () => {
    await mkdir(path.join(root, 'a', '.git'), { recursive: true });
    const found = await detectProjects(root);
    const a = found.find((p) => p.path === 'a');
    expect(a?.status).toBe('project');
    expect(a?.confidence).toBeCloseTo(0.8);
  });

  it('solo package.json queda como frontera desconocida', async () => {
    await touch('b/package.json');
    const b = (await detectProjects(root)).find((p) => p.path === 'b');
    expect(b?.status).toBe('unknown-boundary');
  });

  it('manifiesto mas src, tests y README llega a proyecto', async () => {
    await touch('c/package.json');
    await touch('c/src/index.ts');
    await touch('c/tests/a.test.ts');
    await touch('c/README.md');
    const c = (await detectProjects(root)).find((p) => p.path === 'c');
    expect(c?.status).toBe('project');
  });

  it('un manifiesto en la raiz no absorbe a los hijos', async () => {
    await touch('package.json');
    await mkdir(path.join(root, 'hijo', '.git'), { recursive: true });
    const found = await detectProjects(root);
    expect(found.find((p) => p.path === 'hijo')?.status).toBe('project');
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/detector/detect.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/detector/detect.ts`**

```ts
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectCandidate, ProjectStatus } from '../core/types.js';

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'pom.xml', 'composer.json',
];

const W_GIT = 0.8;
const W_MANIFEST = 0.5;
const W_SRC_TESTS = 0.2;
const W_README = 0.05;

const THRESHOLD_PROJECT = 0.75;
const THRESHOLD_UNKNOWN = 0.4;

function classify(confidence: number): ProjectStatus {
  if (confidence >= THRESHOLD_PROJECT) return 'project';
  if (confidence >= THRESHOLD_UNKNOWN) return 'unknown-boundary';
  return 'not-project';
}

async function scoreDir(absDir: string): Promise<{ confidence: number; markers: string[] }> {
  let names: string[];
  try {
    names = await readdir(absDir);
  } catch {
    return { confidence: 0, markers: [] };
  }
  const set = new Set(names);
  const markers: string[] = [];
  let confidence = 0;

  if (set.has('.git')) { confidence += W_GIT; markers.push('.git'); }

  const manifest = MANIFESTS.find((m) => set.has(m));
  if (manifest) { confidence += W_MANIFEST; markers.push(manifest); }

  if (set.has('src') && set.has('tests')) {
    confidence += W_SRC_TESTS;
    markers.push('src+tests');
  }

  if (names.some((n) => /^readme(\.|$)/i.test(n))) {
    confidence += W_README;
    markers.push('README');
  }

  return { confidence: Math.min(1, confidence), markers };
}

/**
 * Clasifica cada hijo directo de `root`. Cada hijo se evalúa por sus propias
 * señales: un manifiesto en `root` nunca absorbe a sus hijos.
 */
export async function detectProjects(root: string): Promise<ProjectCandidate[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const out: ProjectCandidate[] = [];

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const abs = path.join(root, e.name);
    const { confidence, markers } = await scoreDir(abs);
    out.push({ path: e.name, confidence, markers, status: classify(confidence) });
  }

  const self = await scoreDir(root);
  out.push({
    path: '.',
    confidence: self.confidence,
    markers: self.markers,
    status: classify(self.confidence),
  });

  return out;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/detector/detect.test.ts`
Esperado: PASS, cuatro tests.

- [ ] **Step 5: Commitear**

```bash
git add src/detector tests/detector
git commit -m "feat: detector de proyectos por senales con confianza"
```

---

## Task 5: Collector de sistema de ficheros

**Files:**
- Create: `src/collectors/filesystem.ts`
- Test: `tests/collectors/filesystem.test.ts`

Los directorios generados se registran como entrada pero no se recorren, para
que una futura regla pueda verlos sin pagar el coste de descender.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/collectors/filesystem.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { walk } from '../../src/collectors/filesystem.js';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('walk', () => {
  it('registra node_modules sin descender', async () => {
    await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'left-pad', 'i.js'), 'x');
    const r = await walk(root, new Budget(DEFAULT_LIMITS));
    const nm = r.files.find((f) => f.path === 'node_modules');
    expect(nm?.notDescended).toBe(true);
    expect(r.files.some((f) => f.path.startsWith('node_modules/'))).toBe(false);
  });

  it('marca truncated al superar el tope de ficheros', async () => {
    for (let i = 0; i < 5; i++) await writeFile(path.join(root, `f${i}.txt`), 'x');
    const r = await walk(root, new Budget({ ...DEFAULT_LIMITS, maxFilesScanned: 2 }));
    expect(r.truncated).toBe(true);
  });

  it('calcula profundidad y usa separador barra', async () => {
    await mkdir(path.join(root, 'a', 'b'), { recursive: true });
    await writeFile(path.join(root, 'a', 'b', 'c.txt'), 'x');
    const r = await walk(root, new Budget(DEFAULT_LIMITS));
    const c = r.files.find((f) => f.path === 'a/b/c.txt');
    expect(c?.depth).toBe(3);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/collectors/filesystem.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/collectors/filesystem.ts`**

```ts
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
}

export async function walk(root: string, budget: Budget): Promise<WalkResult> {
  const files: FileEntry[] = [];
  let truncated = false;

  async function visit(absDir: string, relDir: string, depth: number): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
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

      if (isDir && !generated && !st.isSymbolicLink()) {
        await visit(abs, rel, depth + 1);
      }
    }
  }

  await visit(root, '', 0);
  return { files, truncated };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/collectors/filesystem.test.ts`
Esperado: PASS, tres tests.

- [ ] **Step 5: Commitear**

```bash
git add src/collectors/filesystem.ts tests/collectors/filesystem.test.ts
git commit -m "feat: collector de sistema de ficheros con topes"
```

---

## Task 6: Collector de Git

**Files:**
- Create: `src/collectors/git.ts`
- Test: `tests/collectors/git.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/collectors/git.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectGit } from '../../src/collectors/git.js';

const run = promisify(execFile);
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('collectGit', () => {
  it('devuelve isRepo false fuera de un repositorio', async () => {
    const facts = await collectGit(root);
    expect(facts.isRepo).toBe(false);
    expect(facts.trackedFiles.size).toBe(0);
  });

  it('lista ficheros versionados y sucios', async () => {
    await run('git', ['init', '-b', 'main'], { cwd: root });
    await run('git', ['config', 'user.email', 't@t.t'], { cwd: root });
    await run('git', ['config', 'user.name', 'T'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'uno');
    await run('git', ['add', 'a.txt'], { cwd: root });
    await run('git', ['commit', '-m', 'x'], { cwd: root });
    await writeFile(path.join(root, 'a.txt'), 'dos');

    const facts = await collectGit(root);
    expect(facts.isRepo).toBe(true);
    expect(facts.trackedFiles.has('a.txt')).toBe(true);
    expect(facts.dirtyFiles.has('a.txt')).toBe(true);
    expect(facts.currentBranch).toBe('main');
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/collectors/git.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/collectors/git.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitFacts } from '../core/types.js';

const run = promisify(execFile);

function empty(): GitFacts {
  return {
    isRepo: false,
    root: null,
    currentBranch: null,
    defaultBranch: null,
    trackedFiles: new Set(),
    ignoredFiles: new Set(),
    dirtyFiles: new Set(),
    stashCount: 0,
  };
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

const lines = (s: string | null): string[] =>
  s ? s.split('\n').map((l) => l.trim()).filter(Boolean) : [];

/**
 * Resuelve la rama por defecto en el orden acordado: origin/HEAD, luego main,
 * luego master. Devuelve null si ninguna existe, y en ese caso las reglas de
 * rama no emiten hallazgo.
 */
async function resolveDefaultBranch(cwd: string): Promise<string | null> {
  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head) {
    const name = head.trim().split('/').pop();
    if (name) return name;
  }
  for (const candidate of ['main', 'master']) {
    const ok = await git(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
    if (ok) return candidate;
  }
  return null;
}

export async function collectGit(cwd: string): Promise<GitFacts> {
  const rootOut = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!rootOut) return empty();

  const tracked = new Set(lines(await git(cwd, ['ls-files'])));
  const ignored = new Set(
    lines(await git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard'])),
  );

  const status = lines(await git(cwd, ['status', '--porcelain']));
  const dirty = new Set(status.map((l) => l.slice(2).trim()).filter(Boolean));

  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null;
  const stashes = lines(await git(cwd, ['stash', 'list'])).length;

  return {
    isRepo: true,
    root: rootOut.trim(),
    currentBranch: branch,
    defaultBranch: await resolveDefaultBranch(cwd),
    trackedFiles: tracked,
    ignoredFiles: ignored,
    dirtyFiles: dirty,
    stashCount: stashes,
  };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/collectors/git.test.ts`
Esperado: PASS, dos tests.

- [ ] **Step 5: Commitear**

```bash
git add src/collectors/git.ts tests/collectors/git.test.ts
git commit -m "feat: collector de hechos de Git"
```

---

## Task 7: Lectura de contenido, hash y entropía

**Files:**
- Create: `src/collectors/content.ts`
- Test: `tests/collectors/content.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/collectors/content.test.ts
import { describe, it, expect } from 'vitest';
import { shannonEntropy, looksBinary } from '../../src/collectors/content.js';

describe('content', () => {
  it('da entropia baja a texto repetido', () => {
    expect(shannonEntropy('aaaaaaaaaaaaaaaa')).toBeLessThan(1);
  });

  it('da entropia alta a una cadena aleatoria', () => {
    expect(shannonEntropy('kJ8fQ2xZ7pR4vN1mB6tL9wY3')).toBeGreaterThan(4);
  });

  it('detecta binario por byte nulo', () => {
    expect(looksBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
    expect(looksBinary(Buffer.from('hola', 'utf8'))).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/collectors/content.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/collectors/content.ts`**

```ts
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
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/collectors/content.test.ts`
Esperado: PASS, tres tests.

- [ ] **Step 5: Commitear**

```bash
git add src/collectors/content.ts tests/collectors/content.test.ts
git commit -m "feat: lectura acotada de contenido, hash, entropia y huella"
```

---

## Task 8: Guardia de expresiones regulares

**Files:**
- Create: `src/rules/regex-guard.ts`
- Test: `tests/rules/regex-guard.test.ts`

Sustituye a `max_regex_steps`, que Node no puede ofrecer sin dependencia nativa.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/rules/regex-guard.test.ts
import { describe, it, expect } from 'vitest';
import { assertSafeRegex, UnsafeRegexError } from '../../src/rules/regex-guard.js';

describe('assertSafeRegex', () => {
  it('acepta un patron corriente', () => {
    expect(() => assertSafeRegex('(?i)\\.log$')).not.toThrow();
  });

  it('rechaza cuantificador anidado', () => {
    expect(() => assertSafeRegex('(a+)+$')).toThrow(UnsafeRegexError);
  });

  it('rechaza alternancia repetida ambigua', () => {
    expect(() => assertSafeRegex('(a|aa)*$')).toThrow(UnsafeRegexError);
  });

  it('rechaza un patron excesivamente largo', () => {
    expect(() => assertSafeRegex('a'.repeat(1001))).toThrow(UnsafeRegexError);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/rules/regex-guard.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/rules/regex-guard.ts`**

```ts
export class UnsafeRegexError extends Error {}

const MAX_PATTERN_LENGTH = 1000;

/** Grupo cuantificado que a su vez contiene un cuantificador: (a+)+ */
const NESTED_QUANTIFIER = /\([^()]*[+*}][^()]*\)\s*[+*]/;
/** Alternancia con ramas solapables bajo repetición: (a|aa)* */
const AMBIGUOUS_ALTERNATION = /\([^()]*\|[^()]*\)\s*[+*]/;

/**
 * Rechaza patrones con riesgo de retroceso exponencial. Es deliberadamente
 * conservador: prefiere rechazar una regla legítima a colgar una auditoría.
 */
export function assertSafeRegex(pattern: string): void {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new UnsafeRegexError(`patron demasiado largo: ${pattern.length}`);
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    throw new UnsafeRegexError('cuantificador anidado');
  }
  if (AMBIGUOUS_ALTERNATION.test(pattern)) {
    throw new UnsafeRegexError('alternancia repetida ambigua');
  }
}

/** Traduce el prefijo `(?i)` de la especificación a la bandera de JavaScript. */
export function compile(pattern: string): RegExp {
  assertSafeRegex(pattern);
  if (pattern.startsWith('(?i)')) return new RegExp(pattern.slice(4), 'i');
  return new RegExp(pattern);
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/rules/regex-guard.test.ts`
Esperado: PASS, cuatro tests.

- [ ] **Step 5: Commitear**

```bash
git add src/rules/regex-guard.ts tests/rules/regex-guard.test.ts
git commit -m "feat: guardia estatica contra expresiones regulares peligrosas"
```

---

## Task 9: Schema y cargador de packs

**Files:**
- Create: `rules/pack.schema.json`, `src/rules/schema.ts`
- Test: `tests/rules/schema.test.ts`

- [ ] **Step 1: Escribir `rules/pack.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "project-hygiene rule pack",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "pack_id", "version", "axis", "rules"],
  "properties": {
    "schema_version": { "const": 1 },
    "pack_id": { "type": "string", "pattern": "^[a-z0-9.-]+$" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "axis": { "enum": ["filesystem", "git", "security", "ai"] },
    "rules": { "type": "array", "minItems": 1, "items": { "$ref": "#/definitions/rule" } }
  },
  "definitions": {
    "rule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "title", "why", "severity", "risk", "confidence", "match", "suggests"],
      "properties": {
        "id": { "type": "string", "pattern": "^(FS|GIT|SEC|AI)-[A-Z]+-\\d{3}$" },
        "title": { "type": "string", "minLength": 1 },
        "why": { "type": "string", "minLength": 1 },
        "severity": { "enum": ["info", "low", "medium", "high", "critical"] },
        "risk": { "enum": ["safe", "low", "medium", "high", "unknown"] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "deprecated": { "type": "boolean" },
        "docs": { "type": "string" },
        "evidence": { "type": "array", "items": { "type": "string" } },
        "match": { "$ref": "#/definitions/match" },
        "suggests": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["type"],
            "properties": {
              "type": { "enum": ["quarantine", "ignore", "move", "create", "review", "none"] }
            }
          }
        }
      }
    },
    "match": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "maxProperties": 1,
      "properties": {
        "all": { "type": "array", "items": { "$ref": "#/definitions/match" } },
        "any": { "type": "array", "items": { "$ref": "#/definitions/match" } },
        "none": { "type": "array", "items": { "$ref": "#/definitions/match" } },
        "glob": { "type": "string" },
        "path_regex": { "type": "string" },
        "basename_regex": { "type": "string" },
        "depth_gt": { "type": "integer" },
        "is_file": { "type": "boolean" },
        "is_dir": { "type": "boolean" },
        "is_symlink": { "type": "boolean" },
        "is_empty": { "type": "boolean" },
        "size_gt": { "type": "integer" },
        "size_lt": { "type": "integer" },
        "older_than": { "type": "string", "pattern": "^\\d+[dhm]$" },
        "newer_than": { "type": "string", "pattern": "^\\d+[dhm]$" },
        "tracked_by_git": { "type": "boolean" },
        "ignored_by_git": { "type": "boolean" },
        "git_status": { "enum": ["clean", "dirty"] },
        "content_matches": { "type": "string" },
        "entropy_gt": { "type": "number" },
        "sha256_duplicate": { "type": "boolean" },
        "referenced_by_source": { "type": "boolean" }
      }
    }
  }
}
```

`maxProperties: 1` en `match` obliga a que cada nodo sea un único predicado o un
único combinador, que es lo que hace el árbol inequívoco.

- [ ] **Step 2: Escribir el test que falla**

```ts
// tests/rules/schema.test.ts
import { describe, it, expect } from 'vitest';
import { parsePack, PackValidationError } from '../../src/rules/schema.js';

const valido = `
schema_version: 1
pack_id: test.pack
version: 1.0.0
axis: filesystem
rules:
  - id: FS-TEMP-001
    title: Log abandonado
    why: Los logs son artefactos generados.
    severity: low
    risk: safe
    confidence: 0.9
    match:
      all:
        - glob: "**/*.log"
        - is_file: true
    suggests:
      - type: review
`;

describe('parsePack', () => {
  it('acepta un pack valido', () => {
    const pack = parsePack(valido, 'test.yml');
    expect(pack.rules[0]?.id).toBe('FS-TEMP-001');
  });

  it('rechaza un predicado desconocido', () => {
    const malo = valido.replace('- glob: "**/*.log"', '- ejecuta_shell: "rm -rf /"');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('rechaza un campo de mas en la regla', () => {
    const malo = valido.replace('    confidence: 0.9', '    confidence: 0.9\n    inventado: si');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('rechaza un id que no sigue el patron', () => {
    const malo = valido.replace('FS-TEMP-001', 'temporales');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('rechaza una regex peligrosa dentro del match', () => {
    const malo = valido.replace('- glob: "**/*.log"', '- basename_regex: "(a+)+$"');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });
});
```

- [ ] **Step 3: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/rules/schema.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 4: Implementar `src/rules/schema.ts`**

```ts
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import Ajv, { type ValidateFunction } from 'ajv';
import type { Axis, Severity, Risk, SuggestionType } from '../core/types.js';
import { assertSafeRegex, UnsafeRegexError } from './regex-guard.js';

export class PackValidationError extends Error {}

export interface MatchNode {
  all?: MatchNode[];
  any?: MatchNode[];
  none?: MatchNode[];
  [predicate: string]: unknown;
}

export interface Rule {
  id: string;
  title: string;
  why: string;
  severity: Severity;
  risk: Risk;
  confidence: number;
  deprecated?: boolean;
  docs?: string;
  evidence?: string[];
  match: MatchNode;
  suggests: { type: SuggestionType }[];
}

export interface Pack {
  schema_version: 1;
  pack_id: string;
  version: string;
  axis: Axis;
  rules: Rule[];
}

const REGEX_KEYS = new Set(['path_regex', 'basename_regex', 'content_matches']);
const MAX_MATCH_NODES = 256;

/** Recorre el árbol `match` comprobando las regex y el tamaño del árbol. */
function auditMatchTree(node: MatchNode, seen = { n: 0 }): void {
  seen.n += 1;
  if (seen.n > MAX_MATCH_NODES) {
    throw new PackValidationError(`arbol match demasiado grande (> ${MAX_MATCH_NODES} nodos)`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'all' || key === 'any' || key === 'none') {
      for (const child of value as MatchNode[]) auditMatchTree(child, seen);
    } else if (REGEX_KEYS.has(key)) {
      try {
        assertSafeRegex(String(value));
      } catch (err) {
        if (err instanceof UnsafeRegexError) {
          throw new PackValidationError(`regex insegura en ${key}: ${err.message}`);
        }
        throw err;
      }
    }
  }
}

function validateWith(data: unknown, source: string, validate: ValidateFunction): Pack {
  if (!validate(data)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
      .join('; ');
    throw new PackValidationError(`${source}: ${detail}`);
  }
  const pack = data as Pack;
  const ids = new Set<string>();
  for (const rule of pack.rules) {
    if (ids.has(rule.id)) throw new PackValidationError(`${source}: id duplicado ${rule.id}`);
    ids.add(rule.id);
    auditMatchTree(rule.match);
  }
  return pack;
}

const schemaCache = new Map<string, ValidateFunction>();

function compiledValidator(schemaPath: string): ValidateFunction {
  const hit = schemaCache.get(schemaPath);
  if (hit) return hit;
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  schemaCache.set(schemaPath, validate);
  return validate;
}

const DEFAULT_SCHEMA = path.join(process.cwd(), 'rules', 'pack.schema.json');

/** Puerta de entrada síncrona, pensada para tests. */
export function parsePack(yamlText: string, source: string, schemaPath = DEFAULT_SCHEMA): Pack {
  return validateWith(parseYaml(yamlText), source, compiledValidator(schemaPath));
}

/** Puerta de entrada de la CLI: carga todos los packs de un directorio. */
export async function loadPacks(rulesDir: string): Promise<Pack[]> {
  const validate = compiledValidator(path.join(rulesDir, 'pack.schema.json'));
  const names = (await readdir(rulesDir)).filter((n) => n.endsWith('.yml')).sort();
  const packs: Pack[] = [];
  for (const name of names) {
    const raw = await readFile(path.join(rulesDir, name), 'utf8');
    packs.push(validateWith(parseYaml(raw), name, validate));
  }
  return packs;
}
```

- [ ] **Step 5: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/rules/schema.test.ts`
Esperado: PASS, cinco tests.

- [ ] **Step 6: Commitear**

```bash
git add rules/pack.schema.json src/rules/schema.ts tests/rules/schema.test.ts
git commit -m "feat: JSON Schema estricto y cargador de packs"
```

---

## Task 10: Predicados

**Files:**
- Create: `src/engine/predicates.ts`
- Test: `tests/engine/predicates.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/engine/predicates.test.ts
import { describe, it, expect } from 'vitest';
import { evalPredicate, type EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry } from '../../src/core/types.js';

const entry: FileEntry = {
  path: 'src/debug-final.ts',
  absPath: '/tmp/x/src/debug-final.ts',
  isDir: false,
  isSymlink: false,
  size: 120,
  mtimeMs: Date.now() - 100 * 24 * 3600 * 1000,
  depth: 2,
  notDescended: false,
};

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  entry,
  git: null,
  content: { text: async () => 'hola', hash: async () => 'abc' },
  duplicateHashes: new Set(),
  referencedPaths: new Set(),
  now: Date.now(),
  ...over,
});

describe('evalPredicate', () => {
  it('glob casa por ruta', async () => {
    expect(await evalPredicate('glob', '**/*.ts', ctx())).toBe(true);
    expect(await evalPredicate('glob', '**/*.md', ctx())).toBe(false);
  });

  it('basename_regex casa solo con el nombre', async () => {
    expect(await evalPredicate('basename_regex', '(?i)-final', ctx())).toBe(true);
    expect(await evalPredicate('basename_regex', '^src', ctx())).toBe(false);
  });

  it('older_than compara contra now', async () => {
    expect(await evalPredicate('older_than', '30d', ctx())).toBe(true);
    expect(await evalPredicate('older_than', '365d', ctx())).toBe(false);
  });

  it('tracked_by_git es false sin repositorio', async () => {
    expect(await evalPredicate('tracked_by_git', true, ctx())).toBe(false);
  });

  it('entropy_gt usa el texto del fichero', async () => {
    const alto = ctx({
      content: { text: async () => 'kJ8fQ2xZ7pR4vN1mB6tL9wY3', hash: async () => null },
    });
    expect(await evalPredicate('entropy_gt', 4, alto)).toBe(true);
    expect(await evalPredicate('entropy_gt', 4, ctx())).toBe(false);
  });

  it('un predicado desconocido lanza error', async () => {
    await expect(evalPredicate('inventado', true, ctx())).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/engine/predicates.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/engine/predicates.ts`**

```ts
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
  /** Hashes que aparecen en más de un fichero del inventario. */
  duplicateHashes: Set<string>;
  /** Rutas cuyo nombre aparece citado en algún fichero de código. */
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
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/engine/predicates.test.ts`
Esperado: PASS, seis tests.

- [ ] **Step 5: Commitear**

```bash
git add src/engine/predicates.ts tests/engine/predicates.test.ts
git commit -m "feat: vocabulario cerrado de predicados"
```

---

## Task 11: Evaluador de reglas

**Files:**
- Create: `src/engine/evaluate.ts`
- Test: `tests/engine/evaluate.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/engine/evaluate.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../../src/engine/evaluate.js';
import type { Rule } from '../../src/rules/schema.js';
import type { EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry } from '../../src/core/types.js';

const mk = (p: string): FileEntry => ({
  path: p, absPath: `/tmp/${p}`, isDir: false, isSymlink: false,
  size: 10, mtimeMs: Date.now(), depth: 1, notDescended: false,
});

const ctxFor = (entry: FileEntry): EvalContext => ({
  entry, git: null,
  content: { text: async () => null, hash: async () => null },
  duplicateHashes: new Set(), referencedPaths: new Set(), now: Date.now(),
});

const rule: Rule = {
  id: 'FS-TEMP-001',
  title: 'Log abandonado',
  why: 'Artefacto generado.',
  severity: 'low', risk: 'safe', confidence: 0.9,
  match: { all: [{ glob: '**/*.log' }, { none: [{ glob: 'keep/**' }] }] },
  suggests: [{ type: 'review' }],
};

describe('evaluateRule', () => {
  it('casa un log suelto', async () => {
    expect(await evaluateRule(rule, ctxFor(mk('debug.log')))).toBe(true);
  });

  it('none excluye la carpeta protegida', async () => {
    expect(await evaluateRule(rule, ctxFor(mk('keep/debug.log')))).toBe(false);
  });

  it('any exige al menos una rama', async () => {
    const r: Rule = { ...rule, match: { any: [{ glob: '**/*.tmp' }, { glob: '**/*.log' }] } };
    expect(await evaluateRule(r, ctxFor(mk('a.tmp')))).toBe(true);
    expect(await evaluateRule(r, ctxFor(mk('a.md')))).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/engine/evaluate.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/engine/evaluate.ts`**

```ts
import type { Rule, MatchNode, Pack } from '../rules/schema.js';
import type { Finding, LimitHit, Inventory } from '../core/types.js';
import { evalPredicate, type EvalContext } from './predicates.js';
import type { Budget } from '../core/limits.js';

async function evalNode(node: MatchNode, ctx: EvalContext): Promise<boolean> {
  const first = Object.entries(node)[0];
  if (!first) return true;
  const [key, value] = first;

  if (key === 'all') {
    for (const child of value as MatchNode[]) {
      if (!(await evalNode(child, ctx))) return false;
    }
    return true;
  }
  if (key === 'any') {
    for (const child of value as MatchNode[]) {
      if (await evalNode(child, ctx)) return true;
    }
    return false;
  }
  if (key === 'none') {
    for (const child of value as MatchNode[]) {
      if (await evalNode(child, ctx)) return false;
    }
    return true;
  }
  return evalPredicate(key, value, ctx);
}

export async function evaluateRule(rule: Rule, ctx: EvalContext): Promise<boolean> {
  return evalNode(rule.match, ctx);
}

export interface EvaluationInput {
  inventory: Inventory;
  packs: Pack[];
  budget: Budget;
  makeContext(path: string): EvalContext;
}

export interface EvaluationOutput {
  findings: Finding[];
  limits: LimitHit[];
}

export async function evaluateAll(input: EvaluationInput): Promise<EvaluationOutput> {
  const findings: Finding[] = [];
  const limits: LimitHit[] = [];
  let counter = 0;

  for (const pack of input.packs) {
    for (const rule of pack.rules) {
      if (rule.deprecated) continue;
      input.budget.startRule(rule.id);
      let matches = 0;
      let stopped: string | null = null;

      for (const entry of input.inventory.files) {
        if (input.budget.ruleExpired()) { stopped = 'timeout_ms_per_rule'; break; }
        if (input.budget.totalExpired()) { stopped = 'timeout_ms_total'; break; }
        if (matches >= input.budget.limits.maxRuleMatches) { stopped = 'max_rule_matches'; break; }

        const ctx = input.makeContext(entry.path);
        if (!(await evaluateRule(rule, ctx))) continue;

        matches += 1;
        counter += 1;
        findings.push({
          id: `F-${String(counter).padStart(6, '0')}`,
          ruleId: rule.id,
          axis: pack.axis,
          path: entry.path,
          severity: rule.severity,
          risk: rule.risk,
          confidence: rule.confidence,
          reason: rule.title,
          evidence: { size: entry.size, mtimeMs: entry.mtimeMs, depth: entry.depth },
          suggests: rule.suggests.map((s) => s.type),
        });
      }

      if (stopped) limits.push({ ruleId: rule.id, limit: stopped });
    }
  }

  return { findings, limits };
}
```

El campo `evidence` solo lleva metadatos. **Nunca** debe llevar contenido del
fichero: es lo que garantiza el test de la tarea 16.

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/engine/evaluate.test.ts`
Esperado: PASS, tres tests.

- [ ] **Step 5: Commitear**

```bash
git add src/engine/evaluate.ts tests/engine/evaluate.test.ts
git commit -m "feat: evaluador del arbol match con corte por presupuesto"
```

---

## Task 12: Scorer

**Files:**
- Create: `src/scorer/score.ts`
- Test: `tests/scorer/score.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/scorer/score.test.ts
import { describe, it, expect } from 'vitest';
import { computeScore } from '../../src/scorer/score.js';
import type { Finding } from '../../src/core/types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'F-1', ruleId: 'FS-TEMP-001', axis: 'filesystem', path: 'a.log',
  severity: 'low', risk: 'safe', confidence: 0.9, reason: '', evidence: {},
  suggests: ['review'], ...over,
});

describe('computeScore', () => {
  it('sin hallazgos da 100 y limpio', () => {
    const s = computeScore([], []);
    expect(s.total).toBe(100);
    expect(s.clean).toBe(true);
  });

  it('cien hallazgos pesan diez veces mas que uno, no cien', () => {
    const uno = computeScore([f({})], []);
    const cien = computeScore(Array.from({ length: 100 }, () => f({})), []);
    const bajaUno = 100 - uno.total;
    const bajaCien = 100 - cien.total;
    expect(bajaCien).toBeGreaterThan(bajaUno * 8);
    expect(bajaCien).toBeLessThan(bajaUno * 12);
  });

  it('un hallazgo critico topa el total en 59', () => {
    const s = computeScore(
      [f({ axis: 'security', severity: 'critical', ruleId: 'SEC-SECRET-001' })], []);
    expect(s.total).toBeLessThanOrEqual(59);
    expect(s.clean).toBe(false);
    expect(s.blockers.join(' ')).toContain('critical');
  });

  it('un riesgo unknown impide declarar limpio sin restar', () => {
    const s = computeScore([f({ severity: 'info', risk: 'unknown' })], []);
    expect(s.total).toBe(100);
    expect(s.clean).toBe(false);
  });

  it('un limite de ejecucion impide declarar limpio', () => {
    const s = computeScore([], [{ ruleId: 'FS-TEMP-001', limit: 'timeout_ms_per_rule' }]);
    expect(s.clean).toBe(false);
    expect(s.blockers.join(' ')).toContain('FS-TEMP-001');
  });
});
```

El segundo test usa un margen de 8 a 12 en vez de exactamente 10 porque el total
se redondea a entero.

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/scorer/score.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/scorer/score.ts`**

```ts
import type { Axis, Finding, LimitHit, Score, Severity } from '../core/types.js';
import { ENGINE_VERSION, SCORE_PROFILE } from '../core/version.js';

const WEIGHT: Record<Axis, number> = {
  filesystem: 30, git: 25, security: 30, ai: 15,
};

const SATURATION: Record<Axis, number> = {
  filesystem: 60, git: 40, security: 40, ai: 30,
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0, low: 1, medium: 3, high: 8, critical: 20,
};

const CRITICAL_CAP = 59;

export function computeScore(findings: Finding[], limits: LimitHit[]): Score {
  const perRule = new Map<string, { axis: Axis; severity: Severity; n: number }>();
  for (const f of findings) {
    const hit = perRule.get(f.ruleId);
    if (hit) hit.n += 1;
    else perRule.set(f.ruleId, { axis: f.axis, severity: f.severity, n: 1 });
  }

  const penalty: Record<Axis, number> = { filesystem: 0, git: 0, security: 0, ai: 0 };
  for (const { axis, severity, n } of perRule.values()) {
    penalty[axis] += SEVERITY_WEIGHT[severity] * Math.sqrt(n);
  }

  const axes = {} as Record<Axis, number>;
  let total = 0;
  for (const axis of Object.keys(WEIGHT) as Axis[]) {
    const value = WEIGHT[axis] * Math.max(0, 1 - penalty[axis] / SATURATION[axis]);
    axes[axis] = Math.round(value * 100) / 100;
    total += value;
  }
  total = Math.round(total);

  const blockers: string[] = [];

  const criticals = findings.filter((f) => f.severity === 'critical');
  if (criticals.length > 0) {
    total = Math.min(total, CRITICAL_CAP);
    blockers.push(`${criticals.length} hallazgo(s) critical`);
  }

  const unknowns = findings.filter((f) => f.risk === 'unknown');
  if (unknowns.length > 0) {
    blockers.push(`${unknowns.length} hallazgo(s) con riesgo unknown`);
  }

  for (const l of limits) {
    blockers.push(`RULE_EXECUTION_LIMIT ${l.ruleId} (${l.limit})`);
  }

  return {
    profile: SCORE_PROFILE,
    engineVersion: ENGINE_VERSION,
    total,
    axes,
    clean: blockers.length === 0,
    blockers,
  };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/scorer/score.test.ts`
Esperado: PASS, cinco tests.

- [ ] **Step 5: Commitear**

```bash
git add src/scorer tests/scorer
git commit -m "feat: scorer con formula documentada y bloqueadores"
```

---

## Task 13: Los cuatro packs de reglas

**Files:**
- Create: `rules/filesystem.yml`, `rules/git.yml`, `rules/security.yml`, `rules/ai.yml`
- Test: `tests/rules/packs.test.ts`

Solo entran reglas cuyos predicados existen tras la tarea 10.

- [ ] **Step 1: Escribir `rules/filesystem.yml`**

```yaml
schema_version: 1
pack_id: hygiene.filesystem.core
version: 1.0.0
axis: filesystem
rules:
  - id: FS-TEMP-001
    title: Fichero de log abandonado
    why: Un log es un artefacto generado. Fuera de una carpeta ignorada suele ser residuo.
    severity: low
    risk: safe
    confidence: 0.9
    match:
      all:
        - glob: "**/*.log"
        - is_file: true
        - older_than: 30d
    evidence: [size, mtime]
    suggests:
      - type: quarantine
      - type: review

  - id: FS-TEMP-002
    title: Archivo comprimido abandonado
    why: Un zip o un tar sin referencia suele ser una descarga olvidada, no una dependencia.
    severity: low
    risk: medium
    confidence: 0.6
    match:
      all:
        - any:
            - glob: "**/*.zip"
            - glob: "**/*.tar.gz"
            - glob: "**/*.rar"
        - is_file: true
        - older_than: 90d
    evidence: [size, mtime]
    suggests:
      - type: review

  - id: FS-NAMING-001
    title: Fichero versionado a mano por el nombre
    why: >
      Un sufijo como final, v2, copy, backup u old indica una copia manual que
      sustituye al control de versiones. No implica que el fichero sea prescindible.
    severity: medium
    risk: medium
    confidence: 0.7
    match:
      all:
        - basename_regex: '(?i)[-_ ](final|v[0-9]+|copy|backup|old|prueba|temp)[0-9]*(\.[^.]+)?$'
        - is_file: true
    evidence: [size, mtime]
    suggests:
      - type: review

  - id: FS-DUP-001
    title: Fichero duplicado por contenido
    why: Dos ficheros con el mismo hash duplican mantenimiento y confunden al lector.
    severity: low
    risk: medium
    confidence: 0.8
    match:
      all:
        - is_file: true
        - sha256_duplicate: true
    evidence: [size]
    suggests:
      - type: review

  - id: FS-DEPTH-001
    title: Anidamiento excesivo
    why: Mas de ocho niveles suele indicar estructura accidental, no diseno.
    severity: info
    risk: safe
    confidence: 0.5
    match:
      all:
        - depth_gt: 8
        - is_file: true
    suggests:
      - type: review

  - id: FS-SYMLINK-001
    title: Enlace simbolico
    why: Un enlace puede apuntar fuera del proyecto y romper la reproducibilidad.
    severity: low
    risk: unknown
    confidence: 0.6
    match:
      is_symlink: true
    suggests:
      - type: review
```

- [ ] **Step 2: Escribir `rules/git.yml`**

```yaml
schema_version: 1
pack_id: hygiene.git.core
version: 1.0.0
axis: git
rules:
  - id: GIT-IGNORE-002
    title: Artefacto generado versionado
    why: Versionar dependencias o builds infla el repositorio y provoca conflictos.
    severity: high
    risk: medium
    confidence: 0.9
    match:
      all:
        - any:
            - glob: "**/node_modules/**"
            - glob: "**/dist/**"
            - glob: "**/build/**"
            - glob: "**/coverage/**"
        - tracked_by_git: true
    suggests:
      - type: ignore
      - type: review

  - id: GIT-DIRTY-001
    title: Cambio sin commitear con antiguedad
    why: Un cambio sin commitear durante semanas se pierde o se pisa.
    severity: low
    risk: high
    confidence: 0.7
    match:
      all:
        - git_status: dirty
        - is_file: true
        - older_than: 14d
    suggests:
      - type: review

  - id: GIT-LARGE-001
    title: Fichero grande versionado
    why: Un binario grande en el arbol hace lento cada clon del repositorio.
    severity: medium
    risk: medium
    confidence: 0.8
    match:
      all:
        - tracked_by_git: true
        - size_gt: 10485760
    evidence: [size]
    suggests:
      - type: review
```

- [ ] **Step 3: Escribir `rules/security.yml`**

```yaml
schema_version: 1
pack_id: hygiene.security.core
version: 1.0.0
axis: security
rules:
  - id: SEC-SECRET-001
    title: Fichero de entorno versionado
    why: Un fichero de entorno versionado expone credenciales a todo el que clone.
    severity: critical
    risk: high
    confidence: 0.95
    match:
      all:
        - any:
            - glob: "**/.env"
            - glob: "**/.env.*"
        - none:
            - glob: "**/.env.example"
            - glob: "**/.env.sample"
        - tracked_by_git: true
    suggests:
      - type: ignore
      - type: review

  - id: SEC-KEY-001
    title: Clave privada en el arbol
    why: Una clave privada nunca debe vivir en un repositorio, ni versionada ni suelta.
    severity: critical
    risk: high
    confidence: 0.9
    match:
      any:
        - basename_regex: '^id_(rsa|dsa|ecdsa|ed25519)$'
        - content_matches: '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    suggests:
      - type: review

  - id: SEC-CERT-001
    title: Certificado con clave publica
    why: >
      Un certificado publico puede ser legitimo y necesario. Se reporta para que
      una persona lo confirme, no como incidencia.
    severity: info
    risk: low
    confidence: 0.5
    match:
      any:
        - glob: "**/*.crt"
        - glob: "**/*.cer"
    suggests:
      - type: review

  - id: SEC-ENTROPY-001
    title: Posible secreto por alta entropia
    why: >
      Una cadena de alta entropia puede ser un hash, un UUID o un token legitimo.
      Se reporta como posible secreto, nunca como confirmado.
    severity: medium
    risk: unknown
    confidence: 0.4
    match:
      all:
        - tracked_by_git: true
        - is_file: true
        - entropy_gt: 4.5
        - none:
            - glob: "**/*.lock"
            - glob: "**/package-lock.json"
            - glob: "**/*.min.js"
            - glob: "**/*.map"
    suggests:
      - type: review
```

- [ ] **Step 4: Escribir `rules/ai.yml`**

```yaml
schema_version: 1
pack_id: hygiene.ai.core
version: 1.0.0
axis: ai
rules:
  - id: AI-SCRATCH-001
    title: Fichero de trabajo de agente fuera de .tmp
    why: >
      Planes, borradores y notas de agente pertenecen a .tmp o al historial de la
      conversacion, no a la raiz del proyecto.
    severity: medium
    risk: low
    confidence: 0.7
    match:
      all:
        - basename_regex: '(?i)^(plan|scratch|notes|todo|analysis|resumen|informe)[-_ ]?[0-9]*\.(md|txt|json)$'
        - none:
            - glob: ".tmp/**"
            - glob: "docs/**"
        - is_file: true
    suggests:
      - type: review

  - id: AI-SCRIPT-001
    title: Script de un solo uso en la raiz
    why: Un script suelto en la raiz sin carpeta scripts suele ser residuo de una sesion.
    severity: medium
    risk: medium
    confidence: 0.6
    match:
      all:
        - path_regex: '^[^/]+\.(sh|mjs|cjs|py)$'
        - none:
            - basename_regex: '^(setup|install|build|release)\.'
        - is_file: true
    suggests:
      - type: review

  - id: AI-STATE-001
    title: Estado o cache de agente sin ignorar
    why: El estado de un agente es efimero y no debe versionarse ni acumularse.
    severity: low
    risk: safe
    confidence: 0.8
    match:
      all:
        - any:
            - glob: "**/.claude/state/**"
            - glob: "**/.agent-cache/**"
            - glob: "**/.aider*"
        - ignored_by_git: false
    suggests:
      - type: ignore
      - type: review
```

- [ ] **Step 5: Escribir el test que valida los cuatro packs**

```ts
// tests/rules/packs.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadPacks } from '../../src/rules/schema.js';

const RULES = path.join(process.cwd(), 'rules');

describe('packs de la v1', () => {
  it('los cuatro packs validan contra el schema', async () => {
    const packs = await loadPacks(RULES);
    expect(packs.map((p) => p.axis).sort()).toEqual(['ai', 'filesystem', 'git', 'security']);
  });

  it('ningun id de regla se repite entre packs', async () => {
    const packs = await loadPacks(RULES);
    const ids = packs.flatMap((p) => p.rules.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda regla critica es del eje de seguridad', async () => {
    const packs = await loadPacks(RULES);
    for (const p of packs) {
      for (const r of p.rules) {
        if (r.severity === 'critical') expect(p.axis).toBe('security');
      }
    }
  });
});
```

- [ ] **Step 6: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/rules/packs.test.ts`
Esperado: PASS, tres tests.

- [ ] **Step 7: Commitear**

```bash
git add rules tests/rules/packs.test.ts
git commit -m "feat: packs de reglas de los cuatro ejes"
```

---

## Task 14: Orquestador de auditoría

**Files:**
- Create: `src/audit.ts`
- Test: `tests/audit.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/audit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../src/audit.js';

const RULES = path.join(process.cwd(), 'rules');
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('runAudit', () => {
  it('encuentra un log antiguo y baja la puntuacion', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'x');
    const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await utimes(p, viejo, viejo);

    const result = await runAudit({ root, rulesDir: RULES });
    expect(result.findings.some((f) => f.ruleId === 'FS-TEMP-001')).toBe(true);
    expect(result.score.total).toBeLessThan(100);
  });

  it('un arbol vacio puntua 100 y limpio', async () => {
    const result = await runAudit({ root, rulesDir: RULES });
    expect(result.score.total).toBe(100);
    expect(result.score.clean).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/audit.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/audit.ts`**

```ts
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

/** Nombres de fichero citados dentro de otros ficheros del propio inventario. */
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

  const { files, truncated } = await walk(options.root, budget);
  const projects = await detectProjects(options.root);
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
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/audit.test.ts`
Esperado: PASS, dos tests.

- [ ] **Step 5: Commitear**

```bash
git add src/audit.ts tests/audit.test.ts
git commit -m "feat: orquestador de auditoria de extremo a extremo"
```

---

## Task 15: Test de invariante de solo lectura (NN-4)

**Files:**
- Create: `tests/invariants/read-only.test.ts`

Es el test más importante del proyecto. Si falla, el diseño está roto.

- [ ] **Step 1: Escribir el test**

```ts
// tests/invariants/read-only.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const ESCRITURAS_ASYNC = [
  'writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink',
  'rename', 'copyFile', 'chmod', 'truncate', 'symlink',
] as const;

const ESCRITURAS_SYNC = [
  'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync',
  'unlinkSync', 'renameSync', 'copyFileSync', 'chmodSync', 'truncateSync',
] as const;

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-ro-')); });
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('NN-4: audit es read-only', () => {
  it('no invoca ninguna operacion de escritura del sistema de ficheros', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    await writeFile(path.join(root, '.env'), 'API_KEY=abc');

    const espias = [
      ...ESCRITURAS_ASYNC.map((n) => vi.spyOn(fsp, n as never)),
      ...ESCRITURAS_SYNC.map((n) => vi.spyOn(fs, n as never)),
    ];

    await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });

    const usados = espias.filter((e) => e.mock.calls.length > 0);
    expect(usados, 'audit escribio en disco').toHaveLength(0);
  });
});
```

- [ ] **Step 2: Ejecutar**

Ejecutar: `npx vitest run tests/invariants/read-only.test.ts`
Esperado: PASS. Si falla, localizar la escritura y eliminarla antes de seguir.
No se relaja el test para que pase: se arregla el código.

- [ ] **Step 3: Commitear**

```bash
git add tests/invariants/read-only.test.ts
git commit -m "test: invariante NN-4, audit no escribe en disco"
```

---

## Task 16: Test de no filtración de secretos

**Files:**
- Create: `tests/invariants/no-secret-leak.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
// tests/invariants/no-secret-leak.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const SECRETO = 'sk_live_ZQ7fN2kR8xW4pL6vB1mT9jY3';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-sec-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('los secretos no salen en claro', () => {
  it('el resultado serializado no contiene el valor del secreto', async () => {
    await writeFile(path.join(root, '.env'), `STRIPE_KEY=${SECRETO}\n`);

    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });
    const serializado = JSON.stringify(result, (_k, v) => (v instanceof Set ? [...v] : v));

    expect(serializado).not.toContain(SECRETO);
    expect(serializado).not.toContain('sk_live_');
  });
});
```

- [ ] **Step 2: Ejecutar**

Ejecutar: `npx vitest run tests/invariants/no-secret-leak.test.ts`
Esperado: PASS. Si falla, el fallo está en que algún `evidence` guarda contenido
del fichero. La corrección es quitarlo del hallazgo, no ablandar el test.

- [ ] **Step 3: Commitear**

```bash
git add tests/invariants/no-secret-leak.test.ts
git commit -m "test: ningun secreto aparece en claro en la salida"
```

---

## Task 17: Informe para persona

**Files:**
- Create: `src/report/human.ts`
- Test: `tests/report/human.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/report/human.test.ts
import { describe, it, expect } from 'vitest';
import { renderReport } from '../../src/report/human.js';
import type { AuditResult } from '../../src/core/types.js';

const base: AuditResult = {
  inventory: {
    root: '/x', scannedAt: '', truncated: false,
    files: [], projects: [], gitByProject: {},
  },
  findings: [{
    id: 'F-000001', ruleId: 'FS-TEMP-001', axis: 'filesystem', path: 'debug.log',
    severity: 'low', risk: 'safe', confidence: 0.9, reason: 'Log abandonado',
    evidence: {}, suggests: ['review'],
  }],
  limits: [],
  score: {
    profile: 'v1-core', engineVersion: '0.1.0', total: 97,
    axes: { filesystem: 27, git: 25, security: 30, ai: 15 },
    clean: false, blockers: [],
  },
};

describe('renderReport', () => {
  it('muestra la puntuacion y la regla', () => {
    const out = renderReport(base);
    expect(out).toContain('97/100');
    expect(out).toContain('FS-TEMP-001');
    expect(out).toContain('debug.log');
  });

  it('lista los bloqueadores cuando existen', () => {
    const out = renderReport({
      ...base,
      score: { ...base.score, blockers: ['1 hallazgo critical'] },
    });
    expect(out).toContain('critical');
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/report/human.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/report/human.ts`**

```ts
import type { AuditResult, Axis } from '../core/types.js';

const AXIS_LABEL: Record<Axis, string> = {
  filesystem: 'Ficheros', git: 'Git', security: 'Seguridad', ai: 'IA',
};

export function renderReport(result: AuditResult): string {
  const { score, findings, limits } = result;
  const out: string[] = [];

  out.push(`Puntuacion: ${score.total}/100  perfil ${score.profile}  motor ${score.engineVersion}`);
  out.push('');
  for (const axis of Object.keys(AXIS_LABEL) as Axis[]) {
    out.push(`  ${AXIS_LABEL[axis].padEnd(10)} ${String(score.axes[axis]).padStart(6)}`);
  }
  out.push('');

  if (findings.length === 0) {
    out.push('Sin hallazgos.');
  } else {
    const porRegla = new Map<string, number>();
    for (const f of findings) porRegla.set(f.ruleId, (porRegla.get(f.ruleId) ?? 0) + 1);

    out.push(`Hallazgos: ${findings.length}`);
    for (const [ruleId, n] of [...porRegla].sort((a, b) => b[1] - a[1])) {
      const ejemplo = findings.find((f) => f.ruleId === ruleId);
      out.push(`  ${ruleId.padEnd(16)} ${String(n).padStart(4)}  ${ejemplo?.reason ?? ''}`);
      for (const f of findings.filter((x) => x.ruleId === ruleId).slice(0, 3)) {
        out.push(`      ${f.path}`);
      }
      if (n > 3) out.push(`      y ${n - 3} mas`);
    }
  }

  if (limits.length > 0) {
    out.push('');
    out.push('Limites de ejecucion alcanzados:');
    for (const l of limits) out.push(`  RULE_EXECUTION_LIMIT ${l.ruleId} (${l.limit})`);
  }

  out.push('');
  if (score.clean) {
    out.push('Estado: LIMPIO');
  } else {
    out.push('Estado: NO LIMPIO');
    for (const b of score.blockers) out.push(`  - ${b}`);
  }

  return out.join('\n');
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/report/human.test.ts`
Esperado: PASS, dos tests.

- [ ] **Step 5: Commitear**

```bash
git add src/report tests/report
git commit -m "feat: informe de auditoria para persona"
```

---

## Task 18: CLI

**Files:**
- Create: `src/cli/index.ts`
- Test: `tests/cli/cli.test.ts`

Códigos de salida: `0` limpio, `1` hallazgos, `2` fallo de la herramienta.

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/cli/cli.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';

let root: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-cli-'));
  salida = [];
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('main', () => {
  it('audit sobre un arbol limpio devuelve 0', async () => {
    const code = await main(['audit', root], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('LIMPIO');
  });

  it('audit --json emite JSON parseable', async () => {
    const code = await main(['audit', root, '--json'], print);
    expect(code).toBe(0);
    expect(() => JSON.parse(salida.join('\n'))).not.toThrow();
  });

  it('explain devuelve el porque de una regla', async () => {
    const code = await main(['explain', 'FS-TEMP-001'], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('artefacto generado');
  });

  it('explain de una regla inexistente devuelve 2', async () => {
    expect(await main(['explain', 'NO-EXISTE-001'], print)).toBe(2);
  });

  it('un comando desconocido devuelve 2', async () => {
    expect(await main(['inventado'], print)).toBe(2);
  });

  it('un arbol con clave privada devuelve 1', async () => {
    await writeFile(path.join(root, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----');
    expect(await main(['audit', root], print)).toBe(1);
  });
});
```

El test de `explain` busca "artefacto generado", que aparece en el campo `why`
de `FS-TEMP-001`. Si se reescribe ese texto, hay que actualizar el test.

- [ ] **Step 2: Ejecutar y ver que falla**

Ejecutar: `npx vitest run tests/cli/cli.test.ts`
Esperado: FAIL, módulo no encontrado.

- [ ] **Step 3: Implementar `src/cli/index.ts`**

```ts
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../audit.js';
import { loadPacks } from '../rules/schema.js';
import { renderReport } from '../report/human.js';

export type Printer = (line: string) => void;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `dist/cli` en produccion, `src/cli` en tests: en ambos casos dos niveles arriba. */
const RULES_DIR = path.resolve(HERE, '..', '..', 'rules');

const USAGE = `hygiene <comando> [ruta] [opciones]

Comandos:
  scan [ruta]            Inventario, sin juicio
  audit [ruta]           Hallazgos y puntuacion
  explain <RULE-ID>      Por que existe una regla

Opciones:
  --json                 Salida legible por maquina
  --help                 Esta ayuda

Codigos de salida: 0 limpio, 1 hallazgos, 2 fallo de la herramienta.`;

function replacer(_key: string, value: unknown): unknown {
  return value instanceof Set ? [...value] : value;
}

export async function main(argv: string[], print: Printer = console.log): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, help: { type: 'boolean' } },
    });
  } catch (err) {
    print(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const [command, target] = parsed.positionals;
  const json = parsed.values.json === true;

  if (parsed.values.help === true || !command) {
    print(USAGE);
    return command ? 0 : 2;
  }

  try {
    if (command === 'explain') {
      if (!target) {
        print('Falta el identificador de regla.');
        return 2;
      }
      const packs = await loadPacks(RULES_DIR);
      const rule = packs.flatMap((p) => p.rules).find((r) => r.id === target);
      if (!rule) {
        print(`Regla desconocida: ${target}`);
        return 2;
      }
      if (json) {
        print(JSON.stringify(rule, replacer, 2));
        return 0;
      }
      print(`${rule.id}  ${rule.title}`);
      print('');
      print(rule.why.trim());
      print('');
      print(`severidad ${rule.severity}  riesgo ${rule.risk}  confianza ${rule.confidence}`);
      print(`sugiere: ${rule.suggests.map((s) => s.type).join(', ')}`);
      return 0;
    }

    if (command === 'scan' || command === 'audit') {
      const root = path.resolve(target ?? process.cwd());
      const result = await runAudit({ root, rulesDir: RULES_DIR });

      if (command === 'scan') {
        print(JSON.stringify(result.inventory, replacer, 2));
        return 0;
      }

      print(json ? JSON.stringify(result, replacer, 2) : renderReport(result));
      return result.score.clean ? 0 : 1;
    }

    print(`Comando desconocido: ${command}`);
    print('');
    print(USAGE);
    return 2;
  } catch (err) {
    print(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

const invocadoDirectamente = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invocadoDirectamente) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Ejecutar: `npx vitest run tests/cli/cli.test.ts`
Esperado: PASS, seis tests.

- [ ] **Step 5: Probar la CLI compilada a mano**

Ejecutar: `npm run build && node dist/cli/index.js audit .`
Esperado: informe con puntuación. El código de salida se ve con `echo $?` en
bash o `$LASTEXITCODE` en PowerShell.

- [ ] **Step 6: Commitear**

```bash
git add src/cli tests/cli
git commit -m "feat: CLI con scan, audit y explain"
```

---

## Task 19: Fixtures dorados

**Files:**
- Create: árbol bajo `examples/before/`, `tests/golden/golden.test.ts`

- [ ] **Step 1: Crear el árbol de ejemplo**

```bash
mkdir -p examples/before/proyecto-a/src examples/before/proyecto-a/tests
printf 'x\n' > examples/before/debug.log
printf 'x\n' > examples/before/notas-final.md
printf '{}\n' > examples/before/proyecto-a/package.json
printf 'export {};\n' > examples/before/proyecto-a/src/index.ts
printf 'export {};\n' > examples/before/proyecto-a/tests/index.test.ts
printf '# proyecto a\n' > examples/before/proyecto-a/README.md
printf '# Ejemplo\n\nArbol desordenado que usan los tests dorados.\n' > examples/before/README.md
```

- [ ] **Step 2: Escribir el test dorado**

```ts
// tests/golden/golden.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const OPTS = {
  root: path.join(process.cwd(), 'examples', 'before'),
  rulesDir: path.join(process.cwd(), 'rules'),
};

describe('fixture dorado', () => {
  it('detecta el conjunto esperado de reglas', async () => {
    const result = await runAudit(OPTS);
    const reglas = [...new Set(result.findings.map((f) => f.ruleId))].sort();
    expect(reglas).toMatchSnapshot();
  });

  it('clasifica proyecto-a como proyecto', async () => {
    const result = await runAudit(OPTS);
    const a = result.inventory.projects.find((p) => p.path === 'proyecto-a');
    expect(a?.status).toBe('project');
  });
});
```

`debug.log` recién creado no tiene 30 días, así que `FS-TEMP-001` no salta. La
instantánea recogerá `FS-NAMING-001` por `notas-final.md`. Si aparece una regla
inesperada, es señal de un falso positivo real, no de que el test esté mal.

- [ ] **Step 3: Ejecutar y crear la instantánea**

Ejecutar: `npx vitest run tests/golden/golden.test.ts`
Esperado: PASS, y se crea `tests/golden/__snapshots__/golden.test.ts.snap`.
Revisar a mano la instantánea antes de commitearla.

- [ ] **Step 4: Commitear**

```bash
git add examples tests/golden
git commit -m "test: fixture dorado del arbol de ejemplo"
```

---

## Task 20: Integración continua y dogfooding (NN-5)

**Files:**
- Create: `.github/workflows/ci.yml`, `.gitattributes`
- Modify: `package.json`, bloque `scripts`

- [ ] **Step 1: Crear `.gitattributes`**

El repo se creó en Windows y Git avisa de conversión de finales de línea. Sin
esto, la instantánea dorada puede diferir entre sistemas.

```
* text=auto eol=lf
```

- [ ] **Step 2: Añadir el script de dogfooding a `package.json`**

Dentro de `scripts`, junto a `build`, `typecheck` y `test`:

```json
"dogfood": "node dist/cli/index.js audit ."
```

- [ ] **Step 3: Crear `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      # NN-5: la herramienta se audita a si misma con las mismas reglas.
      # Sin listas de exclusion propias. Si alguien anade debug-final-v2.ts,
      # este paso falla.
      - run: npm run dogfood
```

- [ ] **Step 4: Comprobar el dogfooding en local**

Ejecutar: `npm run build && npm run dogfood`
Esperado: código de salida 0. Si sale 1, se arregla el repositorio, no la regla,
salvo que el hallazgo sea un falso positivo demostrable. En ese caso se corrige
la regla y se explica el porqué en su campo `why`.

Nota probable: `examples/before/notas-final.md` disparará `FS-NAMING-001` al
auditar la raíz del propio repo. Es correcto y deseado, porque demuestra que la
regla funciona. La solución no es excluir `examples/`, sino que el dogfooding
apunte al código y no a los fixtures. Cambiar el script a:

```json
"dogfood": "node dist/cli/index.js audit src && node dist/cli/index.js audit rules"
```

- [ ] **Step 5: Commitear**

```bash
git add .github .gitattributes package.json
git commit -m "ci: matriz de tres sistemas y auditoria del propio repositorio"
```

---

## Task 21: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Escribir el README**

````markdown
# project-hygiene

Audits and organizes software projects and AI-assisted development environments.

Turn AI-assisted vibe coding into maintainable software engineering.

## Principios

1. **Observe before modify.** Primero se entiende el entorno, después se toca.
2. **Unknown means don't touch.** Lo desconocido no se elimina automáticamente.
3. **Reversible by default.** Toda operación destructiva debe poder revertirse.
4. **Policy is separate from execution.** Las reglas dicen qué está mal. El
   usuario aprueba. El ejecutor aplica.

## Uso

```bash
npx project-hygiene audit .
npx project-hygiene audit . --json
npx project-hygiene explain FS-NAMING-001
```

Códigos de salida: `0` limpio, `1` hallazgos, `2` fallo de la herramienta.

## Qué audita hoy

Cuatro ejes: sistema de ficheros y límites de proyecto, higiene de Git, secretos
y seguridad, y artefactos de agentes de IA. Las reglas viven en `rules/` como
YAML legible. Añadir una no requiere tocar el motor.

En esta versión la herramienta **no modifica nada**. `scan`, `audit` y `explain`
son de solo lectura por contrato, y hay un test que falla si alguna vez escriben.

## Licencia

Apache 2.0.
````

- [ ] **Step 2: Commitear**

```bash
git add README.md
git commit -m "docs: README con principios y uso"
```

---

## Autorrevisión del plan

**Cobertura de la especificación.** Las secciones 2, 3, 4, 5, 10, 14 y 15 quedan
cubiertas por las tareas 3 a 21. Las secciones 8, 9, 11, 12 y 13 son de los
planes 2 y 3 por la decisión de alcance declarada arriba. La sección 6 queda a
medias a propósito: los tipos de sugerencia existen y viajan dentro del hallazgo,
pero el planner que los convierte en operaciones es del plan 2.

**Huecos conocidos y aceptados.** `in_git_history` no se implementa, y con él
queda fuera `SEC-HIST-001`. `max_regex_steps` se sustituye por la guardia
estática de la tarea 8 más el tope de longitud de la tarea 7. Las reglas
`FS-ROOT-001`, `FS-BOUNDARY-001`, `FS-GENERATED-001`, `FS-EMPTY-001`,
`GIT-NOREPO-001`, `GIT-IGNORE-001`, `GIT-WORKTREE-001`, `GIT-STASH-001`,
`GIT-BRANCH-001`, `SEC-DB-001`, `SEC-PERM-001`, `AI-DOC-001`, `AI-REPORT-001`,
`AI-OUTSIDE-001` y `AI-DUPDOC-001` necesitan hechos de nivel proyecto o
workspace que el evaluador por fichero de la tarea 11 todavía no expone. Entran
en el plan 2, junto con un evaluador de ámbito de proyecto.

**Consistencia de tipos.** `EvalContext` se define en la tarea 10 y se consume
igual en las tareas 11 y 14. `Rule`, `Pack` y `MatchNode` se definen en la
tarea 9 y se importan sin cambios. `Finding`, `Score` y `AuditResult` se definen
en la tarea 2 y no se alteran después. `Budget.limits` es público porque lo leen
`content.ts`, `evaluate.ts` y `audit.ts`. `ContentCache` se exporta desde
`content.ts` para que `audit.ts` pueda tiparlo sin `ReturnType`.
