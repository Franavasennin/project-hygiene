# project-hygiene v1, plan 3 de 3: ejes completos, prevención y loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cerrar la definición de hecho de la v1. Las 16 reglas que faltan de
los cuatro ejes, configuración por `.hygienerc.yml`, ejecución reversible de
`ignore`, `hygiene init` (modo prevención) y `hygiene loop` (ciclo acotado).

**Architecture:** dos partes, cada una en su propio PR.
- **Parte A (tareas 1-9) cierra los ejes.** El motor gana un ámbito
  `project`: una regla puede evaluarse contra cada candidato a proyecto en vez
  de contra cada fichero. Los hechos de Git se recogen por proyecto, de modo que
  un workspace con varios repos funciona. El vocabulario de predicados crece de
  forma cerrada y validada por schema.
- **Parte B (tareas 10-18) añade la prevención.** Introduce una edición de
  fichero registrada en el journal de `~/.hygiene/`, reversible con
  `restore`. Sobre ella se construyen la operación `ignore` y `hygiene init`.
  `loop` encadena plan, aprobación por política, `clean` y reauditoría.

**Tech Stack:** igual que los planes 1 y 2. TypeScript 5 estricto sobre Node
20+, ESM, Vitest; `yaml`, `ajv` y `picomatch` ya instalados. Git se invoca como
proceso. No se añade ninguna dependencia.

**Referencia:** `docs/superpowers/specs/2026-09-09-project-hygiene-design.md`
(§2, §4, §5, §7, §11-§15, §18). Planes previos en `docs/superpowers/plans/`.

---

## Decisiones de diseño de este plan

Revisarlas antes de ejecutar: cambiar una después obliga a rehacer tareas.

1. **Ámbito de regla `scope: file | project`.** Las reglas de proyecto
   (`GIT-NOREPO-001`, `GIT-IGNORE-001`, `SEC-HIST-001`…) no caben en un
   evaluador por fichero. Una regla `project` se evalúa una vez por candidato
   del detector, incluido `.`. El hallazgo usa como ruta la del candidato.
   Los predicados de proyecto están prohibidos en reglas `file`, y el
   cargador de packs lo rechaza.
2. **El vocabulario de predicados crece, cerrado y validado.** Hay 13
   predicados nuevos, todos en el schema, todos read-only y sin shell
   (spec §4):
   - de fichero: `in_project`, `root_is_workspace`, `in_git_repo`,
     `mode_too_open`, `similar_to_readme_gt`;
   - de proyecto: `project_status`, `has_child`, `is_git_repo`,
     `git_worktree_orphan`, `git_stash_older_than`, `git_branch_stale`,
     `git_branch_orphaned`, `in_git_history`.
3. **`in_git_history` es de proyecto.** Un `.env` borrado ya no está en el
   inventario, así que el predicado mira las rutas tocadas en las últimas
   `max_git_history_commits` versiones de todas las ramas. Si no encuentra
   nada y el historial supera el tope, produce `RULE_EXECUTION_LIMIT` (NN-1).
   Esto implica que en un repo con más de 5000 commits la auditoría no puede
   declararse limpia hasta que se suba el tope en `.hygienerc.yml`. Es lo que
   pide la spec.
4. **`GIT-BRANCH-001`.** `stale` es una rama con upstream, ya fusionada en la
   rama por defecto y sin actividad por encima del umbral. `orphaned` es una
   rama sin upstream, no fusionada y sin actividad. "Sin relación con la rama
   por defecto" se interpreta como "no fusionada": es más útil y más barato que
   buscar ramas sin ancestro común. El hallazgo es uno por proyecto y no lista
   las ramas. La rama por defecto se resuelve en este orden: `origin/HEAD`,
   `git.default_branch` del rc, `main`, `master`. Si no se resuelve, no hay
   hallazgo.
5. **`SEC-PERM-001` en Windows es `unsupported`, no un límite.** El predicado
   lanza `UnsupportedPredicateError`, el evaluador lo anota en
   `AuditResult.unsupported` y el informe lo muestra. No bloquea el "limpio":
   la plataforma no permite comprobarlo y no es algo que el usuario deba
   arreglar.
6. **Simplificaciones explícitas.** `AI-DOC-001` detecta ficheros de
   instrucciones *duplicados* por hash, no *en conflicto*. Detectar conflictos
   es semántico y queda para la capa de IA de la v3. `AI-DUPDOC-001` usa la
   similitud de Jaccard de trigramas de palabras contra el README del mismo
   directorio.
7. **Configuración.** Se leen el `.hygienerc.yml` del root auditado y
   `~/.config/hygiene/config.yml` (o `HYGIENE_USER_CONFIG`), que tiene menos
   precedencia. El schema es estricto. Los `.hygienerc.yml` de subproyectos no
   se aplican: es una limitación aceptada, porque aplicar configuración por
   subproyecto exige partir el motor por proyecto.
8. **En `clean` solo se ejecutan `quarantine` e `ignore`.** `create` y `move`
   siguen planificándose pero no se aprueban. `create` solo lo hace `init`,
   que sabe qué crear. Ninguna regla propone `move` en la v1.
9. **`ignore` escribe en el `.gitignore` del proyecto Git que contiene la
   ruta,** nunca fuera del workspace auditado, aunque el repo real esté más
   arriba. La línea es `/ruta` o `/ruta/` relativa a ese proyecto. Su huella
   es el sha256 del `.gitignore`, o `absent` si no existe. Si la ruta ya está
   versionada, ignorarla no sirve de nada y se degrada a `review`.
10. **Edición registrada.** Toda escritura de `ignore` y de `init` deja una
    entrada en el journal: manifiesto `kind: edit`, copia del original en
    `payload/` y huellas antes y después. `restore` solo deshace la edición
    si el fichero sigue con la huella de después. Si lo creó hygiene, lo
    aparta a la entrada en vez de borrarlo. Varias ediciones sobre el mismo
    fichero se deshacen en orden inverso; en otro orden la huella no cuadra y
    se aborta sin tocar nada.
11. **`init` no pisa nada ajeno.** Los bloques gestionados van entre
    marcadores (`# >>> hygiene` … `# <<< hygiene`) y una segunda ejecución
    no cambia nada. Si existe un hook `pre-commit` que no es nuestro, no se
    toca. Si no existe ningún fichero de instrucciones de agente, no se crea
    uno nuevo (spec §12). El hook avisa, pero no bloquea, si `hygiene` no
    está instalado.
12. **`loop` aprueba por política, y queda registrado.** Cada iteración
    materializa en `~/.hygiene/approvals/`, como IDs concretos, las
    operaciones ejecutables cuyo riesgo no está en
    `loop.require_approval_for_risk` (por defecto `[medium, high, unknown]`).
    Ejecutar `loop` es aprobar esa política. Un agente puede ejecutarlo
    igual que puede ejecutar `approve`; es el mismo límite conocido del plan
    2.
13. **`examples/after/` y la prueba de empaquetado.** El fixture `after` debe
    auditar limpio, con 0 hallazgos. `npm pack` más una instalación en un
    directorio temporal prueba que `dist`, `rules` y `templates` viajan en el
    paquete. Publicar en npm requiere las credenciales del usuario y queda
    fuera.

**Fuera de este plan:** publicar en npm, subir la versión a 1.0.0 (decisión
del usuario), `.hygienerc.yml` por subproyecto, detección de instrucciones de
agente *en conflicto*, `move` y `create` en `clean`, y todo lo de la v2 (packs
nuevos, HTML, SARIF).

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/config/load.ts` | Carga y valida `.hygienerc.yml` y la config de usuario. |
| `src/core/limits.ts` (mod.) | Añade `maxGitHistoryCommits`. |
| `src/core/types.ts` (mod.) | `FileEntry.mode`, `BranchFact`, campos nuevos de `GitFacts`, `UnsupportedHit`, `Operation.edit`, motivos de degradación. |
| `src/collectors/git.ts` (mod.) | Directorios ignorados, stashes con fecha, ramas, historial acotado. |
| `src/collectors/workspace.ts` | Git por proyecto, `gitFor`, `isWorkspace`, recuento de hijos. |
| `src/collectors/filesystem.ts` (mod.) | Guarda el modo POSIX de cada entrada. |
| `src/audit.ts` (mod.) | Contexto con hechos de workspace, entradas de proyecto, ejes filtrables. |
| `src/engine/predicates.ts` (mod.) | Predicados nuevos y errores `RuleLimitError` / `UnsupportedPredicateError`. |
| `src/engine/evaluate.ts` (mod.) | Ámbito `project`, límites y `unsupported` por regla. |
| `src/rules/schema.ts`, `rules/pack.schema.json` (mod.) | `scope` y predicados nuevos; predicados de proyecto prohibidos en reglas de fichero. |
| `rules/*.yml` (mod.) | Las 16 reglas nuevas. |
| `src/executor/edit.ts` | Edición registrada y reversible de un fichero de texto. |
| `src/executor/ignore.ts` | Operación `ignore` sobre `.gitignore`. |
| `src/executor/restore.ts`, `manifest.ts` (mod.) | Restauración de ediciones; referencias `INIT-`. |
| `src/planner/plan.ts`, `src/plan.ts` (mod.) | `ignore` ejecutable con destino y huella. |
| `src/clean.ts` (mod.) | Despacha `quarantine` e `ignore`. |
| `src/init/blocks.ts`, `src/init/templates.ts`, `src/init/run.ts` | Modo prevención. |
| `templates/` | Plantillas de `.gitignore`, hook, bloque de agentes, rc y CI. |
| `src/loop.ts` | Ciclo acotado. |
| `scripts/pack-smoke.mjs` | Prueba de empaquetado. |

---

# PARTE A — Cerrar los cuatro ejes

## Task 1: Cargador de configuración

**Files:**
- Create: `src/config/load.ts`
- Modify: `src/core/limits.ts`
- Test: `tests/config/load.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, ConfigError, DEFAULT_LOOP } from '../../src/config/load.js';

let dir: string;
let user: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hyg-cfg-'));
  user = path.join(dir, 'no-existe.yml');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('loadConfig', () => {
  it('sin ficheros devuelve los valores por defecto', async () => {
    const c = await loadConfig(dir, user);
    expect(c).toEqual({ limits: {}, minConfidence: undefined, defaultBranch: undefined, loop: DEFAULT_LOOP });
  });

  it('lee el .hygienerc.yml del root', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), [
      'engine:',
      '  max_file_size_for_content_scan: 1MB',
      '  max_git_history_commits: 50',
      'planner:',
      '  min_confidence: 0.9',
      'git:',
      '  default_branch: trunk',
      'loop:',
      '  max_iterations: 3',
      '  require_approval_for_risk: [low, medium, high, unknown]',
    ].join('\n'));
    const c = await loadConfig(dir, user);
    expect(c.limits).toEqual({ maxFileSizeForContentScan: 1024 * 1024, maxGitHistoryCommits: 50 });
    expect(c.minConfidence).toBe(0.9);
    expect(c.defaultBranch).toBe('trunk');
    expect(c.loop.maxIterations).toBe(3);
    expect(c.loop.stopOnRegression).toBe(true);
    expect(c.loop.requireApprovalForRisk).toEqual(['low', 'medium', 'high', 'unknown']);
  });

  it('el rc del root gana a la config de usuario', async () => {
    const u = path.join(dir, 'user.yml');
    await writeFile(u, 'planner:\n  min_confidence: 0.5\ngit:\n  default_branch: develop\n');
    await writeFile(path.join(dir, '.hygienerc.yml'), 'planner:\n  min_confidence: 0.7\n');
    const c = await loadConfig(dir, u);
    expect(c.minConfidence).toBe(0.7);
    expect(c.defaultBranch).toBe('develop');
  });

  it('una clave desconocida es un error, no un aviso', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), 'planer:\n  min_confidence: 0.7\n');
    await expect(loadConfig(dir, user)).rejects.toBeInstanceOf(ConfigError);
  });

  it('un YAML roto es un ConfigError', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), 'planner: [\n');
    await expect(loadConfig(dir, user)).rejects.toBeInstanceOf(ConfigError);
  });

  it('un rc vacio es valido', async () => {
    await writeFile(path.join(dir, '.hygienerc.yml'), '# nada\n');
    expect((await loadConfig(dir, user)).loop).toEqual(DEFAULT_LOOP);
  });
});
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `npx vitest run tests/config/load.test.ts`
Expected: FAIL, no se puede resolver `src/config/load.js`.

- [ ] **Step 3: Añadir el límite `maxGitHistoryCommits` a `src/core/limits.ts`**

El cargador traduce las claves del rc con `LIMIT_WIRE_NAMES`, así que el límite
tiene que existir antes. En `src/core/limits.ts`:

1. En la interfaz `Limits`, añadir `maxGitHistoryCommits: number;` después de
   `maxRegexInputLength: number;`.
2. En `DEFAULT_LIMITS`, añadir `maxGitHistoryCommits: 5_000,` después de
   `maxRegexInputLength: 256 * 1024,`.
3. En `LIMIT_WIRE_NAMES`, añadir
   `maxGitHistoryCommits: 'max_git_history_commits',` después de la línea de
   `maxRegexInputLength`.

- [ ] **Step 4: Implementar `src/config/load.ts`**

```ts
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv } from 'ajv';
import { LIMIT_WIRE_NAMES, type Limits } from '../core/limits.js';
import type { Risk } from '../core/types.js';

export class ConfigError extends Error {}

export interface LoopConfig {
  maxIterations: number;
  stopIfNoImprovement: boolean;
  stopOnRegression: boolean;
  requireApprovalForRisk: Risk[];
}

export interface HygieneConfig {
  limits: Partial<Limits>;
  minConfidence?: number;
  defaultBranch?: string;
  loop: LoopConfig;
}

export const DEFAULT_LOOP: LoopConfig = {
  maxIterations: 10,
  stopIfNoImprovement: true,
  stopOnRegression: true,
  requireApprovalForRisk: ['medium', 'high', 'unknown'],
};

interface RawConfig {
  engine?: Record<string, number | string>;
  planner?: { min_confidence?: number };
  git?: { default_branch?: string };
  loop?: {
    max_iterations?: number;
    stop_if_no_improvement?: boolean;
    stop_on_regression?: boolean;
    require_approval_for_risk?: Risk[];
  };
}

const POSITIVE = { type: 'integer', minimum: 1 };
const SIZE = { anyOf: [POSITIVE, { type: 'string', pattern: '^\\d+(KB|MB)$' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    engine: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(Object.values(LIMIT_WIRE_NAMES).map((k) => [
        k, k === 'max_file_size_for_content_scan' ? SIZE : POSITIVE,
      ])),
    },
    planner: {
      type: 'object',
      additionalProperties: false,
      properties: { min_confidence: { type: 'number', minimum: 0, maximum: 1 } },
    },
    git: {
      type: 'object',
      additionalProperties: false,
      properties: { default_branch: { type: 'string', minLength: 1 } },
    },
    loop: {
      type: 'object',
      additionalProperties: false,
      properties: {
        max_iterations: POSITIVE,
        stop_if_no_improvement: { type: 'boolean' },
        stop_on_regression: { type: 'boolean' },
        require_approval_for_risk: {
          type: 'array',
          uniqueItems: true,
          items: { enum: ['safe', 'low', 'medium', 'high', 'unknown'] },
        },
      },
    },
  },
};

const validate = new Ajv({ allErrors: true, strictTypes: false }).compile(SCHEMA);

const WIRE_TO_LIMIT = Object.fromEntries(
  Object.entries(LIMIT_WIRE_NAMES).map(([key, wire]) => [wire, key]),
) as Record<string, keyof Limits>;

function toNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  const n = Number(value.slice(0, -2));
  return value.endsWith('MB') ? n * 1024 * 1024 : n * 1024;
}

async function readRaw(file: string): Promise<RawConfig> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let data: unknown;
  try {
    data = parseYaml(text) ?? {};
  } catch (err) {
    throw new ConfigError(`${file}: YAML invalido: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!validate(data)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
      .join('; ');
    throw new ConfigError(`${file}: ${detail}`);
  }
  return data as RawConfig;
}

function apply(base: HygieneConfig, raw: RawConfig): HygieneConfig {
  const limits: Partial<Limits> = { ...base.limits };
  for (const [wire, value] of Object.entries(raw.engine ?? {})) {
    const key = WIRE_TO_LIMIT[wire];
    if (key) limits[key] = toNumber(value);
  }
  return {
    limits,
    minConfidence: raw.planner?.min_confidence ?? base.minConfidence,
    defaultBranch: raw.git?.default_branch ?? base.defaultBranch,
    loop: {
      maxIterations: raw.loop?.max_iterations ?? base.loop.maxIterations,
      stopIfNoImprovement: raw.loop?.stop_if_no_improvement ?? base.loop.stopIfNoImprovement,
      stopOnRegression: raw.loop?.stop_on_regression ?? base.loop.stopOnRegression,
      requireApprovalForRisk: raw.loop?.require_approval_for_risk ?? base.loop.requireApprovalForRisk,
    },
  };
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HYGIENE_USER_CONFIG ?? path.join(os.homedir(), '.config', 'hygiene', 'config.yml');
}

/**
 * Precedencia (spec §14): `.hygienerc.yml` del root auditado, luego la
 * configuracion de usuario, luego los valores por defecto. Las opciones de
 * CLI se aplican encima en la propia CLI. Los rc de subproyectos no se leen.
 */
export async function loadConfig(root: string, userPath: string = userConfigPath()): Promise<HygieneConfig> {
  const defaults: HygieneConfig = { limits: {}, loop: DEFAULT_LOOP };
  const withUser = apply(defaults, await readRaw(userPath));
  return apply(withUser, await readRaw(path.join(root, '.hygienerc.yml')));
}
```

- [ ] **Step 5: Ejecutar el test y verlo pasar**

Run: `npx vitest run tests/config/load.test.ts tests/core/limits.test.ts`
Expected: PASS.

- [ ] **Step 6: Commitear**

```bash
git add src/config/load.ts src/core/limits.ts tests/config/load.test.ts
git commit -m "feat: configuracion por .hygienerc.yml con schema estricto"
```

---

## Task 2: La configuración llega a todos los comandos

**Files:**
- Modify: `src/audit.ts`, `src/plan.ts`, `src/clean.ts`, `src/cli/index.ts`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/cli/cli.test.ts`, dentro del `beforeEach`, añadir como primera línea
`process.env.HYGIENE_USER_CONFIG = path.join(tmpdir(), 'hyg-no-existe.yml');`
para que ningún test lea la config real de quien los ejecuta. Después, añadir
dentro del `describe('main', ...)`:

```ts
  it('plan respeta el umbral de confianza del .hygienerc.yml', async () => {
    await logViejo('debug.log');
    await writeFile(path.join(root, '.hygienerc.yml'), 'planner:\n  min_confidence: 0.95\n');
    expect(await main(['plan', root, '--json'], print)).toBe(0);
    const plan = JSON.parse(salida.join('\n')) as { operations: { path: string; type: string; degradeReason: string }[] };
    expect(plan.operations.find((o) => o.path === 'debug.log'))
      .toMatchObject({ type: 'review', degradeReason: 'low-confidence' });
  });

  it('un .hygienerc.yml invalido devuelve 2', async () => {
    await writeFile(path.join(root, '.hygienerc.yml'), 'desconocido: 1\n');
    expect(await main(['audit', root], print)).toBe(2);
  });
```

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: FAIL. El plan propone `quarantine` porque la CLI no lee el rc, y el
rc inválido no da error.

- [ ] **Step 2: Ampliar las opciones de auditoría, plan y clean**

En `src/audit.ts`, sustituir la interfaz `AuditOptions` por:

```ts
export interface AuditOptions {
  root: string;
  rulesDir: string;
  limits?: Partial<Limits>;
  /** Rama por defecto configurada (`git.default_branch`). */
  defaultBranch?: string;
}
```

En `src/plan.ts`, sustituir la interfaz `PlanOptions` por:

```ts
export interface PlanOptions extends AuditOptions {
  minConfidence?: number;
}
```

y cambiar la importación `import { collectAudit } from './audit.js';` por
`import { collectAudit, type AuditOptions } from './audit.js';`. Quitar la
importación de `Limits` si queda sin uso.

En `src/clean.ts`, sustituir la interfaz `CleanOptions` por:

```ts
export interface CleanOptions {
  root: string;
  rulesDir: string;
  home: string;
  limits?: Partial<Limits>;
  minConfidence?: number;
  defaultBranch?: string;
  now?: Date;
}
```

y la llamada a `runPlan` dentro de `runClean` por:

```ts
  const { plan } = await runPlan({
    root: o.root, rulesDir: o.rulesDir, limits: o.limits,
    minConfidence: o.minConfidence, defaultBranch: o.defaultBranch,
  });
```

El plan que `clean` recalcula tiene que usar exactamente la misma
configuración que el plan aprobado. Si no, una aprobación válida se vería
caducada.

- [ ] **Step 3: Cargar la configuración en la CLI**

En `src/cli/index.ts`, añadir la importación
`import { loadConfig, type HygieneConfig } from '../config/load.js';` y este
helper debajo de `resolveDir`:

```ts
function engineOptions(root: string, config: HygieneConfig) {
  return {
    root,
    rulesDir: RULES_DIR,
    limits: config.limits,
    minConfidence: config.minConfidence,
    defaultBranch: config.defaultBranch,
  };
}
```

Después:

1. En el bloque `scan`/`audit`, sustituir
   `const result = await runAudit({ root, rulesDir: RULES_DIR });` por
   `const result = await runAudit(engineOptions(root, await loadConfig(root)));`.
2. En el bloque `plan`, sustituir
   `const { audit, plan } = await runPlan({ root, rulesDir: RULES_DIR });` por
   `const { audit, plan } = await runPlan(engineOptions(root, await loadConfig(root)));`.
3. En el bloque `approve`, sustituir
   `const { plan } = await runPlan({ root, rulesDir: RULES_DIR });` por
   `const { plan } = await runPlan(engineOptions(root, await loadConfig(root)));`.
4. En el bloque `clean`, sustituir
   `const result = await runClean({ root, rulesDir: RULES_DIR, home: resolveHome() });` por
   `const result = await runClean({ ...engineOptions(root, await loadConfig(root)), home: resolveHome() });`.

Un `ConfigError` lo captura el `catch` general de `main` y se convierte en
`Error: ...` con código 2.

- [ ] **Step 4: Ejecutar toda la suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commitear**

```bash
git add src/audit.ts src/plan.ts src/clean.ts src/cli/index.ts tests/cli/cli.test.ts
git commit -m "feat: la configuracion llega a audit, plan, approve y clean"
```

---

## Task 3: El collector de Git recoge ramas, stashes, historial y directorios ignorados

**Files:**
- Modify: `src/core/types.ts`, `src/collectors/git.ts`
- Test: `tests/collectors/git-extra.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectGit } from '../../src/collectors/git.js';

const run = promisify(execFile);
let root: string;

async function git(args: string[], date?: string): Promise<void> {
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env;
  await run('git', args, { cwd: root, env });
}

async function commit(file: string, content: string, date?: string): Promise<void> {
  await writeFile(path.join(root, file), content);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', `c ${file}`], date);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-gitx-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@t.t']);
  await git(['config', 'user.name', 'T']);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('collectGit, hechos ampliados', () => {
  it('lista los directorios ignorados sin barra final', async () => {
    await commit('.gitignore', 'node_modules/\n');
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'a.js'), 'x');
    const g = await collectGit(root);
    expect(g.ignoredDirs?.has('node_modules')).toBe(true);
  });

  it('fecha los stashes', async () => {
    await commit('a.txt', 'uno');
    await writeFile(path.join(root, 'a.txt'), 'dos');
    await git(['stash', '-q'], '2020-01-01T00:00:00');
    const g = await collectGit(root);
    expect(g.stashCount).toBe(1);
    expect(g.stashTimesMs?.[0]).toBe(Date.parse('2020-01-01T00:00:00'));
  });

  it('describe las ramas: upstream, fecha y si estan fusionadas', async () => {
    await commit('a.txt', 'uno');
    await git(['branch', 'fusionada']);
    await git(['checkout', '-q', '-b', 'vieja']);
    await commit('b.txt', 'dos', '2020-01-01T00:00:00');
    await git(['checkout', '-q', 'main']);
    const g = await collectGit(root);
    expect(g.defaultBranch).toBe('main');
    const vieja = g.branches?.find((b) => b.name === 'vieja');
    expect(vieja).toMatchObject({ upstream: null, merged: false, lastCommitMs: Date.parse('2020-01-01T00:00:00') });
    expect(g.branches?.find((b) => b.name === 'fusionada')?.merged).toBe(true);
  });

  it('recoge las rutas del historial, incluidas las borradas', async () => {
    await commit('.env', 'K=v');
    await git(['rm', '-q', '.env']);
    await git(['commit', '-q', '-m', 'borra']);
    const g = await collectGit(root);
    expect(g.historyPaths?.has('.env')).toBe(true);
    expect(g.historyTruncated).toBe(false);
  });

  it('marca el historial truncado si supera el tope', async () => {
    await commit('a.txt', '1');
    await commit('b.txt', '2');
    const g = await collectGit(root, { maxHistoryCommits: 1 });
    expect(g.historyTruncated).toBe(true);
  });

  it('usa la rama por defecto configurada si no hay origin/HEAD, main ni master', async () => {
    await git(['checkout', '-q', '-b', 'trunk']);
    await commit('a.txt', '1');
    await git(['branch', '-q', '-D', 'main']).catch(() => undefined);
    const g = await collectGit(root, { defaultBranch: 'trunk' });
    expect(g.defaultBranch).toBe('trunk');
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/collectors/git-extra.test.ts`
Expected: FAIL. `ignoredDirs`, `stashTimesMs`, `branches` e `historyPaths` no
existen, y `collectGit` no acepta opciones.

- [ ] **Step 3: Ampliar los tipos en `src/core/types.ts`**

Añadir antes de `export interface GitFacts`:

```ts
export interface BranchFact {
  name: string;
  upstream: string | null;
  lastCommitMs: number;
  /** Fusionada en la rama por defecto. false si no hay rama por defecto. */
  merged: boolean;
}
```

Y añadir al final de la interfaz `GitFacts`, después de `stashCount: number;`.
Los campos son opcionales para no romper los tests que construyen `GitFacts` a
mano:

```ts
  /** Directorios ignorados enteros, sin barra final. */
  ignoredDirs?: Set<string>;
  stashTimesMs?: number[];
  branches?: BranchFact[];
  /** Rutas tocadas en el historial acotado, relativas a la raiz del repo. */
  historyPaths?: Set<string>;
  historyTruncated?: boolean;
```

- [ ] **Step 4: Ampliar `src/collectors/git.ts`**

1. Cambiar la importación de tipos por
   `import type { BranchFact, GitFacts } from '../core/types.js';`.
2. Sustituir la función `resolveDefaultBranch` entera por:

```ts
/**
 * Resuelve la rama por defecto en el orden de la spec §7: origin/HEAD, la
 * rama configurada en .hygienerc.yml, main, master. null si ninguna existe;
 * en ese caso las reglas de rama no emiten hallazgo.
 */
async function resolveDefaultBranch(cwd: string, configured?: string): Promise<string | null> {
  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head) {
    const name = head.trim().split('/').pop();
    if (name) return name;
  }
  const candidates = configured ? [configured, 'main', 'master'] : ['main', 'master'];
  for (const candidate of candidates) {
    const ok = await git(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
    if (ok) return candidate;
  }
  return null;
}

async function collectBranches(cwd: string, defaultBranch: string | null): Promise<BranchFact[]> {
  const raw = lines(await git(cwd, [
    'for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(upstream:short)%09%(committerdate:unix)',
  ]));
  const merged = defaultBranch
    ? new Set(lines(await git(cwd, ['branch', '--merged', defaultBranch, '--format=%(refname:short)'])))
    : new Set<string>();
  return raw
    .map((line) => {
      const [name = '', upstream = '', ts = '0'] = line.split('\t');
      return { name, upstream: upstream || null, lastCommitMs: Number(ts) * 1000, merged: merged.has(name) };
    })
    .filter((b) => b.name !== '');
}

async function collectHistory(cwd: string, limit: number): Promise<{ paths: Set<string>; truncated: boolean }> {
  const total = Number((await git(cwd, ['rev-list', '--all', '--count']))?.trim() ?? '0');
  const out = await git(cwd, ['log', '--all', '-n', String(limit), '--name-only', '--format=', '-z']);
  const paths = new Set(splitNul(out).map((p) => p.replace(/^\n+/, '')).filter(Boolean));
  return { paths, truncated: total > limit };
}

export interface GitOptions {
  defaultBranch?: string;
  maxHistoryCommits?: number;
}
```

3. Cambiar la firma
   `export async function collectGit(cwd: string): Promise<GitFacts> {` por
   `export async function collectGit(cwd: string, opts: GitOptions = {}): Promise<GitFacts> {`.
4. Sustituir desde
   `const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null;`
   hasta el final de la función por:

```ts
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null;
  const stashTimesMs = lines(await git(cwd, ['stash', 'list', '--format=%ct']))
    .map((s) => Number(s) * 1000)
    .filter((n) => Number.isFinite(n));
  const ignoredDirs = new Set(
    splitNul(await git(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']))
      .filter((p) => p.endsWith('/'))
      .map((p) => p.slice(0, -1)),
  );
  const defaultBranch = await resolveDefaultBranch(cwd, opts.defaultBranch);
  const history = await collectHistory(cwd, opts.maxHistoryCommits ?? 5_000);

  return {
    isRepo: true,
    root: rootOut.trim(),
    currentBranch: branch,
    defaultBranch,
    trackedFiles: tracked,
    ignoredFiles: ignored,
    dirtyFiles: dirty,
    stashCount: stashTimesMs.length,
    ignoredDirs,
    stashTimesMs,
    branches: await collectBranches(cwd, defaultBranch),
    historyPaths: history.paths,
    historyTruncated: history.truncated,
  };
}
```

- [ ] **Step 5: Ejecutar los tests**

Run: `npx vitest run tests/collectors/`
Expected: PASS, también los tests anteriores de `git.test.ts`.

- [ ] **Step 6: Commitear**

```bash
git add src/core/types.ts src/collectors/git.ts tests/collectors/git-extra.test.ts
git commit -m "feat: git recoge ramas, stashes fechados, historial acotado y directorios ignorados"
```

---

## Task 4: Hechos de workspace y Git por proyecto en el contexto de evaluación

**Files:**
- Create: `src/collectors/workspace.ts`
- Modify: `src/core/types.ts`, `src/collectors/filesystem.ts`, `src/engine/predicates.ts`, `src/audit.ts`
- Test: `tests/collectors/workspace.test.ts`, `tests/audit.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

`tests/collectors/workspace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { FileEntry, GitFacts, ProjectCandidate } from '../../src/core/types.js';
import { countChildren, gitFor, gitKeyFor, isWorkspace, prefixGitFacts } from '../../src/collectors/workspace.js';

const facts = (tracked: string[] = []): GitFacts => ({
  isRepo: true, root: '/r', currentBranch: 'main', defaultBranch: 'main',
  trackedFiles: new Set(tracked), ignoredFiles: new Set(), dirtyFiles: new Set(), stashCount: 0,
});
const cand = (p: string, status: ProjectCandidate['status']): ProjectCandidate => ({ path: p, confidence: 0, markers: [], status });
const entry = (p: string): FileEntry => ({
  path: p, absPath: `/r/${p}`, isDir: false, isSymlink: false, size: 1, mtimeMs: 0, depth: 1, notDescended: false,
});

describe('workspace', () => {
  it('un root no-proyecto con un hijo proyecto es workspace', () => {
    expect(isWorkspace([cand('.', 'not-project'), cand('app', 'project')])).toBe(true);
    expect(isWorkspace([cand('.', 'project'), cand('app', 'project')])).toBe(false);
    expect(isWorkspace([cand('.', 'not-project'), cand('docs', 'not-project')])).toBe(false);
  });

  it('cuenta los hijos directos de cada directorio', () => {
    const c = countChildren([entry('a.txt'), entry('src'), entry('src/x.ts'), entry('src/y.ts')]);
    expect(c.get('.')).toBe(2);
    expect(c.get('src')).toBe(2);
    expect(c.get('vacio')).toBeUndefined();
  });

  it('gitFor elige el repo mas interior que contiene la ruta', () => {
    const byProject = { '.': facts(['a.txt']), app: facts(['app/x.ts']) };
    expect(gitKeyFor(byProject, 'a.txt')).toBe('.');
    expect(gitKeyFor(byProject, 'app/x.ts')).toBe('app');
    expect(gitKeyFor(byProject, 'appendix/x.ts')).toBe('.');
    expect(gitFor(byProject, 'app/x.ts')?.trackedFiles.has('app/x.ts')).toBe(true);
    expect(gitFor({}, 'a.txt')).toBeNull();
  });

  it('prefixGitFacts lleva las rutas al espacio del root auditado', () => {
    const g = prefixGitFacts({ ...facts(['x.ts']), ignoredDirs: new Set(['node_modules']) }, 'app');
    expect([...g.trackedFiles]).toEqual(['app/x.ts']);
    expect([...(g.ignoredDirs ?? [])]).toEqual(['app/node_modules']);
  });
});
```

Añadir al final de `tests/audit.test.ts` (que ya importa `writeFile`,
`mkdtemp`, `tmpdir` y `path`; añadir `mkdir` a la importación de
`node:fs/promises` y `import { execFile } from 'node:child_process';` e
`import { promisify } from 'node:util';`):

```ts
describe('workspace con varios repos', () => {
  it('los hechos de git de un repo hijo se aplican a sus ficheros', async () => {
    const run = promisify(execFile);
    const app = path.join(root, 'app');
    await mkdir(app);
    await run('git', ['init', '-q', '-b', 'main'], { cwd: app });
    await run('git', ['config', 'user.email', 't@t.t'], { cwd: app });
    await run('git', ['config', 'user.name', 'T'], { cwd: app });
    await writeFile(path.join(app, '.env'), 'K=v\n');
    await run('git', ['add', '.env'], { cwd: app });
    await run('git', ['commit', '-q', '-m', 'x'], { cwd: app });

    const result = await runAudit({ root, rulesDir: RULES });
    expect(Object.keys(result.inventory.gitByProject)).toEqual(['app']);
    expect(result.findings.some((f) => f.ruleId === 'SEC-SECRET-001' && f.path === 'app/.env')).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/collectors/workspace.test.ts tests/audit.test.ts`
Expected: FAIL. El módulo no existe y la auditoría no ve el repo hijo, así que
`SEC-SECRET-001` no dispara.

- [ ] **Step 3: Tipos y modo POSIX**

En `src/core/types.ts`, añadir a `FileEntry`, después de
`notDescended: boolean;`:

```ts
  /** Modo de lstat. En Windows no refleja permisos reales. */
  mode?: number;
```

En `src/collectors/filesystem.ts`, dentro del `files.push({ ... })`, añadir
`mode: st.mode,` después de `notDescended: generated,`.

En `src/engine/predicates.ts`, cambiar la importación de tipos por
`import type { FileEntry, GitFacts, ProjectCandidate } from '../core/types.js';`
y sustituir la interfaz `EvalContext` por:

```ts
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
```

- [ ] **Step 4: Implementar `src/collectors/workspace.ts`**

```ts
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
```

- [ ] **Step 5: Reescribir el contexto en `src/audit.ts`**

Añadir las importaciones:

```ts
import type { ProjectCandidate } from './core/types.js';
import { collectGitByProject, countChildren, gitFor, isWorkspace } from './collectors/workspace.js';
import type { WorkspaceFacts } from './engine/predicates.js';
```

Quitar `import { collectGit } from './collectors/git.js';`. Sustituir la
función `collectAudit` entera por:

```ts
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

  // Si la ruta pedida no esta en el inventario, se degrada con un FileEntry
  // sintetico minimo en vez de abortar toda la auditoria.
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
  const { findings, limits } = await evaluateAll({ inventory, packs, budget, makeContext });
  const score = computeScore(findings, limits);

  return {
    result: { inventory, findings, limits, score },
    facts: {
      referenced: refs.referenced,
      referencesComplete: refs.complete && !truncated && unreadable.length === 0,
      content,
    },
  };
}
```

- [ ] **Step 6: Ejecutar toda la suite**

Run: `npm run typecheck && npm test`
Expected: PASS. El snapshot dorado no cambia, porque todavía no hay reglas
nuevas.

- [ ] **Step 7: Commitear**

```bash
git add src/collectors/workspace.ts src/core/types.ts src/collectors/filesystem.ts src/engine/predicates.ts src/audit.ts tests/collectors/workspace.test.ts tests/audit.test.ts
git commit -m "feat: hechos de workspace y git por proyecto en el contexto de evaluacion"
```

---

## Task 5: Predicados nuevos

**Files:**
- Modify: `src/engine/predicates.ts`
- Test: `tests/engine/predicates-workspace.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  evalPredicate, RuleLimitError, UnsupportedPredicateError, type EvalContext, type WorkspaceFacts,
} from '../../src/engine/predicates.js';
import type { BranchFact, FileEntry, GitFacts, ProjectCandidate } from '../../src/core/types.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T00:00:00Z');

const entry = (p: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path: p, absPath: `/r/${p}`, isDir: false, isSymlink: false, size: 10,
  mtimeMs: NOW, depth: p === '.' ? 0 : p.split('/').length, notDescended: false, ...extra,
});
const cand = (p: string, status: ProjectCandidate['status']): ProjectCandidate => ({ path: p, confidence: 0, markers: [], status });

function ws(entries: FileEntry[], projects: ProjectCandidate[], rootIsWorkspace = false): WorkspaceFacts {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.path === '.') continue;
    const i = e.path.lastIndexOf('/');
    const parent = i === -1 ? '.' : e.path.slice(0, i);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return { projects, rootIsWorkspace, childCounts: counts, entryAt: (p) => byPath.get(p) };
}

const git = (extra: Partial<GitFacts> = {}): GitFacts => ({
  isRepo: true, root: '/r', currentBranch: 'main', defaultBranch: 'main',
  trackedFiles: new Set(), ignoredFiles: new Set(), dirtyFiles: new Set(), stashCount: 0, ...extra,
});

const ctx = (e: FileEntry, extra: Partial<EvalContext> = {}): EvalContext => ({
  entry: e, git: null,
  content: { text: async () => null, hash: async () => null },
  duplicateHashes: new Set(), referencedPaths: new Set(), now: NOW, ...extra,
});

describe('predicados de fichero nuevos', () => {
  const projects = [cand('.', 'not-project'), cand('app', 'project')];
  const w = ws([entry('.', { isDir: true }), entry('app', { isDir: true }), entry('app/x.ts'), entry('nota.txt')], projects, true);

  it('in_project distingue lo que cae dentro de un proyecto', async () => {
    expect(await evalPredicate('in_project', true, ctx(entry('app/x.ts'), { workspace: w }))).toBe(true);
    expect(await evalPredicate('in_project', false, ctx(entry('nota.txt'), { workspace: w }))).toBe(true);
  });

  it('root_is_workspace lee el hecho del workspace', async () => {
    expect(await evalPredicate('root_is_workspace', true, ctx(entry('nota.txt'), { workspace: w }))).toBe(true);
    expect(await evalPredicate('root_is_workspace', true, ctx(entry('nota.txt')))).toBe(false);
  });

  it('in_git_repo depende de los hechos de git del contexto', async () => {
    expect(await evalPredicate('in_git_repo', true, ctx(entry('a'), { git: git() }))).toBe(true);
    expect(await evalPredicate('in_git_repo', false, ctx(entry('a')))).toBe(true);
  });

  it('ignored_by_git consulta los directorios ignorados para un directorio', async () => {
    const g = git({ ignoredDirs: new Set(['node_modules']) });
    expect(await evalPredicate('ignored_by_git', true, ctx(entry('node_modules', { isDir: true }), { git: g }))).toBe(true);
    expect(await evalPredicate('ignored_by_git', true, ctx(entry('dist', { isDir: true }), { git: g }))).toBe(false);
  });

  it('is_empty de un directorio cuenta hijos, no tamano', async () => {
    const w2 = ws([entry('vacio', { isDir: true, size: 4096 }), entry('lleno', { isDir: true }), entry('lleno/a')], []);
    expect(await evalPredicate('is_empty', true, ctx(entry('vacio', { isDir: true, size: 4096 }), { workspace: w2 }))).toBe(true);
    expect(await evalPredicate('is_empty', true, ctx(entry('lleno', { isDir: true }), { workspace: w2 }))).toBe(false);
  });

  it('mode_too_open mira grupo y otros en POSIX y es unsupported en Windows', async () => {
    expect(await evalPredicate('mode_too_open', true, ctx(entry('id_rsa', { mode: 0o100644 }), { platform: 'linux' }))).toBe(true);
    expect(await evalPredicate('mode_too_open', true, ctx(entry('id_rsa', { mode: 0o100600 }), { platform: 'linux' }))).toBe(false);
    await expect(evalPredicate('mode_too_open', true, ctx(entry('id_rsa'), { platform: 'win32' })))
      .rejects.toBeInstanceOf(UnsupportedPredicateError);
  });

  it('similar_to_readme_gt compara con el README del mismo directorio', async () => {
    const texto = 'este proyecto audita repositorios y propone operaciones reversibles con aprobacion humana';
    const readme = entry('README.md');
    const guia = entry('guia.md');
    const w3 = ws([readme, guia], []);
    const content = {
      text: async (e: FileEntry) => (e.path === 'README.md' ? texto : `# Guia\n${texto}`),
      hash: async () => null,
    };
    expect(await evalPredicate('similar_to_readme_gt', 0.8, ctx(guia, { workspace: w3, content }))).toBe(true);
    expect(await evalPredicate('similar_to_readme_gt', 0.8, ctx(readme, { workspace: w3, content }))).toBe(false);
  });
});

describe('predicados de proyecto', () => {
  const root = entry('.', { isDir: true });

  it('project_status compara con el estado del candidato', async () => {
    const w = ws([root, entry('app', { isDir: true })], [cand('.', 'not-project'), cand('app', 'unknown-boundary')]);
    expect(await evalPredicate('project_status', 'unknown-boundary', ctx(entry('app', { isDir: true }), { workspace: w }))).toBe(true);
    expect(await evalPredicate('project_status', 'project', ctx(root, { workspace: w }))).toBe(false);
  });

  it('has_child busca cualquiera de los nombres en el directorio del candidato', async () => {
    const w = ws([root, entry('package.json'), entry('app', { isDir: true }), entry('app/go.mod')], []);
    expect(await evalPredicate('has_child', ['Cargo.toml', 'package.json'], ctx(root, { workspace: w }))).toBe(true);
    expect(await evalPredicate('has_child', ['go.mod'], ctx(entry('app', { isDir: true }), { workspace: w }))).toBe(true);
    expect(await evalPredicate('has_child', ['.gitignore'], ctx(root, { workspace: w }))).toBe(false);
  });

  it('is_git_repo exige un directorio .git', async () => {
    const conDir = ws([root, entry('.git', { isDir: true })], []);
    const conFichero = ws([root, entry('.git')], []);
    expect(await evalPredicate('is_git_repo', true, ctx(root, { workspace: conDir }))).toBe(true);
    expect(await evalPredicate('is_git_repo', true, ctx(root, { workspace: conFichero }))).toBe(false);
  });

  describe('git_worktree_orphan', () => {
    let dir: string;
    beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'hyg-wt-')); });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

    it('detecta un .git que apunta a un gitdir inexistente', async () => {
      const dotgit = entry('.git', { absPath: path.join(dir, '.git') });
      await writeFile(dotgit.absPath, 'gitdir: ./no/existe\n');
      const w = ws([root, dotgit], []);
      const content = { text: async () => 'gitdir: ./no/existe\n', hash: async () => null };
      expect(await evalPredicate('git_worktree_orphan', true, ctx(root, { workspace: w, content }))).toBe(true);
    });

    it('un gitdir existente no es huerfano', async () => {
      const dotgit = entry('.git', { absPath: path.join(dir, '.git') });
      const w = ws([root, dotgit], []);
      const content = { text: async () => `gitdir: ${dir}\n`, hash: async () => null };
      expect(await evalPredicate('git_worktree_orphan', true, ctx(root, { workspace: w, content }))).toBe(false);
    });
  });

  it('git_stash_older_than', async () => {
    const g = git({ stashTimesMs: [NOW - 40 * DAY] });
    expect(await evalPredicate('git_stash_older_than', '30d', ctx(root, { git: g }))).toBe(true);
    expect(await evalPredicate('git_stash_older_than', '60d', ctx(root, { git: g }))).toBe(false);
  });

  it('git_branch_stale y git_branch_orphaned', async () => {
    const branches: BranchFact[] = [
      { name: 'main', upstream: 'origin/main', lastCommitMs: NOW - 500 * DAY, merged: true },
      { name: 'fusionada', upstream: 'origin/fusionada', lastCommitMs: NOW - 200 * DAY, merged: true },
      { name: 'suelta', upstream: null, lastCommitMs: NOW - 200 * DAY, merged: false },
    ];
    const g = git({ branches });
    expect(await evalPredicate('git_branch_stale', '90d', ctx(root, { git: g }))).toBe(true);
    expect(await evalPredicate('git_branch_orphaned', '90d', ctx(root, { git: g }))).toBe(true);
    expect(await evalPredicate('git_branch_orphaned', '365d', ctx(root, { git: g }))).toBe(false);
    expect(await evalPredicate('git_branch_stale', '90d', ctx(root, { git: { ...g, defaultBranch: null } }))).toBe(false);
  });

  it('in_git_history con excepciones y tope', async () => {
    const spec = { paths: ['**/.env', '**/.env.*'], except: ['**/.env.example'] };
    const encontrado = git({ historyPaths: new Set(['config/.env']), historyTruncated: false });
    const soloEjemplo = git({ historyPaths: new Set(['.env.example']), historyTruncated: false });
    const truncado = git({ historyPaths: new Set(['a.ts']), historyTruncated: true });
    expect(await evalPredicate('in_git_history', spec, ctx(root, { git: encontrado }))).toBe(true);
    expect(await evalPredicate('in_git_history', spec, ctx(root, { git: soloEjemplo }))).toBe(false);
    await expect(evalPredicate('in_git_history', spec, ctx(root, { git: truncado }))).rejects.toBeInstanceOf(RuleLimitError);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/engine/predicates-workspace.test.ts`
Expected: FAIL, `RuleLimitError` y `UnsupportedPredicateError` no están
exportados.

- [ ] **Step 3: Implementar en `src/engine/predicates.ts`**

Añadir las importaciones `import { stat } from 'node:fs/promises';` e
`import path from 'node:path';`. Debajo de
`export class UnknownPredicateError extends Error {}`, añadir:

```ts
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
```

En el `switch` de `evalPredicate`:

1. Sustituir el caso `is_empty` por:

```ts
    case 'is_empty': {
      // Un directorio esta vacio si no tiene hijos inventariados; su tamano
      // no significa nada (4096 en Linux, 0 en Windows).
      const empty = e.isDir && ctx.workspace
        ? !e.notDescended && (ctx.workspace.childCounts.get(e.path) ?? 0) === 0
        : e.size === 0;
      return empty === Boolean(value);
    }
```

2. Sustituir el caso `ignored_by_git` por:

```ts
    case 'ignored_by_git': {
      const ignored = e.isDir
        ? (ctx.git?.ignoredDirs?.has(e.path) ?? false)
        : (ctx.git?.ignoredFiles.has(e.path) ?? false);
      return ignored === Boolean(value);
    }
```

3. Añadir antes de `default:`:

```ts
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
```

- [ ] **Step 4: Ejecutar los tests**

Run: `npx vitest run tests/engine/`
Expected: PASS, también `predicates.test.ts`.

- [ ] **Step 5: Commitear**

```bash
git add src/engine/predicates.ts tests/engine/predicates-workspace.test.ts
git commit -m "feat: predicados de workspace, de proyecto y de historial de git"
```

---

## Task 6: Ámbito de proyecto en el schema y el evaluador

**Files:**
- Modify: `rules/pack.schema.json`, `src/rules/schema.ts`, `src/engine/evaluate.ts`, `src/core/types.ts`, `src/audit.ts`, `src/report/human.ts`
- Test: `tests/rules/schema-scope.test.ts`, `tests/engine/evaluate-scope.test.ts`, `tests/report/human.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

`tests/rules/schema-scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePack, PackValidationError } from '../../src/rules/schema.js';

const pack = (rule: string) => [
  'schema_version: 1', 'pack_id: test.scope', 'version: 1.0.0', 'axis: git', 'rules:',
  '  - id: GIT-TEST-001', '    title: t', '    why: w', '    severity: low', '    risk: low',
  '    confidence: 0.5', '    suggests: [{ type: review }]', rule,
].join('\n');

describe('scope de regla', () => {
  it('acepta una regla de proyecto con predicados de proyecto', () => {
    expect(() => parsePack(pack("    scope: project\n    match: { has_child: ['.git'] }"), 't.yml')).not.toThrow();
  });

  it('rechaza un predicado de proyecto en una regla de fichero', () => {
    expect(() => parsePack(pack("    match: { has_child: ['.git'] }"), 't.yml')).toThrow(PackValidationError);
  });

  it('rechaza un scope desconocido', () => {
    expect(() => parsePack(pack('    scope: repo\n    match: { is_file: true }'), 't.yml')).toThrow(PackValidationError);
  });

  it('valida la forma de in_git_history', () => {
    expect(() => parsePack(pack("    scope: project\n    match: { in_git_history: { paths: ['**/.env'] } }"), 't.yml')).not.toThrow();
    expect(() => parsePack(pack("    scope: project\n    match: { in_git_history: ['**/.env'] }"), 't.yml')).toThrow(PackValidationError);
  });
});
```

`tests/engine/evaluate-scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateAll } from '../../src/engine/evaluate.js';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';
import type { EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry, GitFacts, Inventory } from '../../src/core/types.js';
import type { Pack, Rule } from '../../src/rules/schema.js';

const entry = (p: string, isDir = false): FileEntry => ({
  path: p, absPath: `/r/${p}`, isDir, isSymlink: false, size: 1, mtimeMs: 0, depth: 1, notDescended: false,
});
const rule = (extra: Partial<Rule>): Rule => ({
  id: 'GIT-TEST-001', title: 't', why: 'w', severity: 'low', risk: 'low', confidence: 0.5,
  match: { is_dir: true }, suggests: [{ type: 'review' }], ...extra,
});
const packOf = (r: Rule): Pack => ({ schema_version: 1, pack_id: 'p', version: '1.0.0', axis: 'git', rules: [r] });
const inventory: Inventory = {
  root: '/r', scannedAt: '', truncated: false,
  files: [entry('src', true), entry('a.ts')], projects: [], gitByProject: {},
};
const git: GitFacts = {
  isRepo: true, root: '/r', currentBranch: 'main', defaultBranch: 'main', trackedFiles: new Set(),
  ignoredFiles: new Set(), dirtyFiles: new Set(), stashCount: 0,
  historyPaths: new Set(['a.ts']), historyTruncated: true,
};
const makeContext = (platform: NodeJS.Platform = 'linux') => (p: string): EvalContext => ({
  entry: p === '.' ? entry('.', true) : inventory.files.find((f) => f.path === p) ?? entry(p),
  git, content: { text: async () => null, hash: async () => null },
  duplicateHashes: new Set(), referencedPaths: new Set(), now: 0, platform,
});

describe('evaluateAll con scope', () => {
  it('una regla de proyecto solo ve las entradas de proyecto', async () => {
    const out = await evaluateAll({
      inventory, packs: [packOf(rule({ scope: 'project' }))], budget: new Budget(DEFAULT_LIMITS),
      makeContext: makeContext(), projectEntries: [entry('.', true)],
    });
    expect(out.findings.map((f) => f.path)).toEqual(['.']);
  });

  it('una regla de fichero sigue viendo el inventario', async () => {
    const out = await evaluateAll({
      inventory, packs: [packOf(rule({}))], budget: new Budget(DEFAULT_LIMITS),
      makeContext: makeContext(), projectEntries: [entry('.', true)],
    });
    expect(out.findings.map((f) => f.path)).toEqual(['src']);
  });

  it('un RuleLimitError se registra una vez como limite y no produce hallazgo', async () => {
    const r = rule({ scope: 'project', match: { in_git_history: { paths: ['**/.env'] } } });
    const out = await evaluateAll({
      inventory, packs: [packOf(r)], budget: new Budget(DEFAULT_LIMITS),
      makeContext: makeContext(), projectEntries: [entry('.', true), entry('src', true)],
    });
    expect(out.findings).toEqual([]);
    expect(out.limits).toEqual([{ ruleId: 'GIT-TEST-001', limit: 'max_git_history_commits' }]);
  });

  it('un predicado no soportado se reporta como unsupported y corta la regla', async () => {
    const r = rule({ match: { mode_too_open: true } });
    const out = await evaluateAll({
      inventory, packs: [packOf(r)], budget: new Budget(DEFAULT_LIMITS), makeContext: makeContext('win32'),
    });
    expect(out.findings).toEqual([]);
    expect(out.unsupported).toEqual([{ ruleId: 'GIT-TEST-001', reason: 'los permisos POSIX no existen en Windows' }]);
    expect(out.limits).toEqual([]);
  });
});
```

En `tests/report/human.test.ts`, añadir un test que construya un
`AuditResult` (reutilizando el helper o literal que use ese fichero) con
`unsupported: [{ ruleId: 'SEC-PERM-001', reason: 'los permisos POSIX no existen en Windows' }]`
y compruebe que `renderReport` contiene `No soportado en esta plataforma` y
`SEC-PERM-001`.

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/rules/schema-scope.test.ts tests/engine/evaluate-scope.test.ts tests/report/human.test.ts`
Expected: FAIL.

- [ ] **Step 3: Ampliar `rules/pack.schema.json`**

En `definitions.rule.properties`, añadir después de `"deprecated"`:

```json
        "scope": { "enum": ["file", "project"] },
```

En `definitions.match.properties`, añadir después de `"referenced_by_source"`
(con la coma correspondiente en la línea anterior):

```json
        "in_project": { "type": "boolean" },
        "root_is_workspace": { "type": "boolean" },
        "in_git_repo": { "type": "boolean" },
        "mode_too_open": { "type": "boolean" },
        "similar_to_readme_gt": { "type": "number", "minimum": 0, "maximum": 1 },
        "project_status": { "enum": ["project", "unknown-boundary", "not-project"] },
        "has_child": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
        "is_git_repo": { "type": "boolean" },
        "git_worktree_orphan": { "type": "boolean" },
        "git_stash_older_than": { "type": "string", "pattern": "^\\d+[dhm]$" },
        "git_branch_stale": { "type": "string", "pattern": "^\\d+[dhm]$" },
        "git_branch_orphaned": { "type": "string", "pattern": "^\\d+[dhm]$" },
        "in_git_history": {
          "type": "object",
          "additionalProperties": false,
          "required": ["paths"],
          "properties": {
            "paths": { "type": "array", "minItems": 1, "items": { "type": "string" } },
            "except": { "type": "array", "items": { "type": "string" } }
          }
        }
```

- [ ] **Step 4: Comprobar el ámbito en `src/rules/schema.ts`**

1. En la interfaz `Rule`, añadir `scope?: 'file' | 'project';` después de
   `deprecated?: boolean;`.
2. Añadir debajo de `const MAX_MATCH_NODES = 256;`:

```ts
/** Predicados que solo tienen sentido contra un candidato a proyecto. */
const PROJECT_ONLY = new Set([
  'project_status', 'has_child', 'is_git_repo', 'git_worktree_orphan',
  'git_stash_older_than', 'git_branch_stale', 'git_branch_orphaned', 'in_git_history',
]);
```

3. Sustituir la firma
   `function auditMatchTree(node: MatchNode, seen = { n: 0 }): void {` por
   `function auditMatchTree(node: MatchNode, seen = { n: 0 }, scope: 'file' | 'project' = 'file'): void {`,
   la llamada recursiva `auditMatchTree(child, seen)` por
   `auditMatchTree(child, seen, scope)`, y añadir dentro del `for`, como
   primera instrucción:

```ts
    if (scope === 'file' && PROJECT_ONLY.has(key)) {
      throw new PackValidationError(`el predicado ${key} solo vale en reglas con scope: project`);
    }
```

4. En `validateWith`, sustituir `auditMatchTree(rule.match);` por
   `auditMatchTree(rule.match, { n: 0 }, rule.scope ?? 'file');`.

- [ ] **Step 5: Tipos y evaluador**

En `src/core/types.ts`, añadir debajo de `LimitHit`:

```ts
export interface UnsupportedHit {
  ruleId: string;
  reason: string;
}
```

y añadir a `AuditResult`, después de `score: Score;`:

```ts
  /** Reglas que la plataforma no permite evaluar (spec §7, SEC-PERM-001). */
  unsupported?: UnsupportedHit[];
```

En `src/engine/evaluate.ts`:

1. Cambiar las importaciones por:

```ts
import type { Rule, MatchNode, Pack } from '../rules/schema.js';
import type { FileEntry, Finding, LimitHit, Inventory, UnsupportedHit } from '../core/types.js';
import {
  evalPredicate, RuleLimitError, UnsupportedPredicateError, type EvalContext,
} from './predicates.js';
import type { Budget } from '../core/limits.js';
```

2. Sustituir `EvaluationInput` y `EvaluationOutput` por:

```ts
export interface EvaluationInput {
  inventory: Inventory;
  packs: Pack[];
  budget: Budget;
  makeContext(path: string): EvalContext;
  /** Entradas contra las que se evaluan las reglas con scope: project. */
  projectEntries?: FileEntry[];
}

export interface EvaluationOutput {
  findings: Finding[];
  limits: LimitHit[];
  unsupported: UnsupportedHit[];
}
```

3. Sustituir el cuerpo de `evaluateAll` (desde `const findings: Finding[] = [];`
   hasta el `return` incluido) por:

```ts
  const findings: Finding[] = [];
  const limits: LimitHit[] = [];
  const unsupported: UnsupportedHit[] = [];
  let counter = 0;
  let totalTimedOut = false;

  outer:
  for (const pack of input.packs) {
    for (const rule of pack.rules) {
      if (rule.deprecated) continue;

      if (input.budget.totalExpired()) {
        totalTimedOut = true;
        limits.push({ ruleId: rule.id, limit: 'timeout_ms_total' });
        break outer;
      }

      input.budget.startRule(rule.id);
      let matches = 0;
      let stopped: string | null = null;
      let limitNoted = false;
      const entries = rule.scope === 'project' ? (input.projectEntries ?? []) : input.inventory.files;

      for (const entry of entries) {
        if (input.budget.ruleExpired()) { stopped = 'timeout_ms_per_rule'; break; }
        if (input.budget.totalExpired()) { stopped = 'timeout_ms_total'; totalTimedOut = true; break; }
        if (!input.budget.within('maxRuleMatches', matches)) { stopped = 'max_rule_matches'; break; }

        let matched: boolean;
        try {
          matched = await evaluateRule(rule, input.makeContext(entry.path));
        } catch (err) {
          if (err instanceof RuleLimitError) {
            if (!limitNoted) limits.push({ ruleId: rule.id, limit: err.limit });
            limitNoted = true;
            continue;
          }
          if (err instanceof UnsupportedPredicateError) {
            unsupported.push({ ruleId: rule.id, reason: err.message });
            break;
          }
          throw err;
        }
        if (!matched) continue;

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
      if (totalTimedOut) break outer;
    }
  }

  return { findings, limits, unsupported };
```

En `src/audit.ts`, dentro de `collectAudit`, sustituir:

```ts
  const packs = await loadPacks(options.rulesDir);
  const { findings, limits } = await evaluateAll({ inventory, packs, budget, makeContext });
  const score = computeScore(findings, limits);
```

por:

```ts
  const projectEntries = projects
    .map((c) => byPath.get(c.path))
    .filter((e): e is FileEntry => e !== undefined);
  const packs = await loadPacks(options.rulesDir);
  const { findings, limits, unsupported } = await evaluateAll({
    inventory, packs, budget, makeContext, projectEntries,
  });
  const score = computeScore(findings, limits);
```

y `result: { inventory, findings, limits, score },` por
`result: { inventory, findings, limits, score, unsupported },`.

En `src/report/human.ts`, añadir justo antes de `out.push('');` del bloque
final de estado (la línea que precede a `if (score.clean) {`):

```ts
  if (result.unsupported && result.unsupported.length > 0) {
    out.push('');
    out.push('No soportado en esta plataforma:');
    for (const u of result.unsupported) out.push(`  ${u.ruleId} (${u.reason})`);
  }
```

- [ ] **Step 6: Ejecutar toda la suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commitear**

```bash
git add rules/pack.schema.json src/rules/schema.ts src/engine/evaluate.ts src/core/types.ts src/audit.ts src/report/human.ts tests/rules/schema-scope.test.ts tests/engine/evaluate-scope.test.ts tests/report/human.test.ts
git commit -m "feat: reglas con scope de proyecto, limites por predicado y unsupported en el informe"
```

---

## Task 7: Reglas nuevas de ficheros y de agentes

**Files:**
- Modify: `rules/filesystem.yml`, `rules/ai.yml`
- Test: `tests/rules/reglas-v1-fs-ai.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const run = promisify(execFile);
const RULES = path.join(process.cwd(), 'rules');
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-r3-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function file(rel: string, content = 'x'): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content);
}
async function gitInit(rel = '.'): Promise<void> {
  const cwd = path.join(root, rel);
  await mkdir(cwd, { recursive: true });
  await run('git', ['init', '-q', '-b', 'main'], { cwd });
}
async function hallazgos(rule: string): Promise<string[]> {
  const result = await runAudit({ root, rulesDir: RULES });
  return result.findings.filter((f) => f.ruleId === rule).map((f) => f.path).sort();
}

describe('reglas de ficheros', () => {
  it('FS-ROOT-001: fichero suelto en la raiz de un workspace', async () => {
    await gitInit('app');
    await file('app/package.json', '{}');
    await file('notas.txt');
    await file('README.md');
    expect(await hallazgos('FS-ROOT-001')).toEqual(['notas.txt']);
  });

  it('FS-ROOT-001 no dispara si el root no es un workspace', async () => {
    await file('notas.txt');
    expect(await hallazgos('FS-ROOT-001')).toEqual([]);
  });

  it('FS-BOUNDARY-001: candidato con confianza insuficiente', async () => {
    await file('app/package.json', '{}');
    expect(await hallazgos('FS-BOUNDARY-001')).toEqual(['app']);
  });

  it('FS-GENERATED-001: node_modules sin ignorar en un repo', async () => {
    await gitInit();
    await file('node_modules/a.js');
    expect(await hallazgos('FS-GENERATED-001')).toEqual(['node_modules']);
  });

  it('FS-GENERATED-001 no dispara si esta ignorado', async () => {
    await gitInit();
    await file('.gitignore', 'node_modules/\n');
    await file('node_modules/a.js');
    expect(await hallazgos('FS-GENERATED-001')).toEqual([]);
  });

  it('FS-EMPTY-001: directorio vacio', async () => {
    await mkdir(path.join(root, 'vacio'));
    await file('lleno/a.txt');
    expect(await hallazgos('FS-EMPTY-001')).toEqual(['vacio']);
  });
});

describe('reglas de agentes', () => {
  it('AI-DOC-001: ficheros de instrucciones duplicados', async () => {
    await file('CLAUDE.md', 'reglas');
    await file('sub/CLAUDE.md', 'reglas');
    expect(await hallazgos('AI-DOC-001')).toEqual(['CLAUDE.md', 'sub/CLAUDE.md']);
  });

  it('AI-REPORT-001: informe que nada referencia', async () => {
    await file('audit-report.md', '# informe');
    expect(await hallazgos('AI-REPORT-001')).toEqual(['audit-report.md']);
  });

  it('AI-REPORT-001 no dispara si algo lo referencia', async () => {
    await file('audit-report.md', '# informe');
    await file('README.md', 'ver audit-report.md');
    expect(await hallazgos('AI-REPORT-001')).toEqual([]);
  });

  it('AI-OUTSIDE-001: directorio de agente fuera de todo proyecto', async () => {
    await gitInit('app');
    await file('app/package.json', '{}');
    await file('.claude/settings.json', '{}');
    expect(await hallazgos('AI-OUTSIDE-001')).toEqual(['.claude']);
  });

  it('AI-DUPDOC-001: documento que duplica el README', async () => {
    const texto = Array.from({ length: 40 }, (_, i) => `la herramienta audita el repositorio paso ${i}`).join('\n');
    await file('README.md', texto);
    await file('guia.md', `# Guia\n${texto}`);
    expect(await hallazgos('AI-DUPDOC-001')).toEqual(['guia.md']);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/rules/reglas-v1-fs-ai.test.ts`
Expected: FAIL. Las reglas no existen, salvo en los dos casos que esperan `[]`.

- [ ] **Step 3: Añadir al final de `rules/filesystem.yml`**

```yaml

  - id: FS-ROOT-001
    title: Fichero suelto en la raiz del workspace
    why: >
      En un workspace con proyectos, un fichero de la raiz que no pertenece a
      ninguno suele ser un resto de sesion. Un README, una licencia o la
      configuracion del propio workspace son legitimos.
    severity: low
    risk: medium
    confidence: 0.6
    match:
      all:
        - root_is_workspace: true
        - is_file: true
        - in_project: false
        - none:
            - depth_gt: 1
            - basename_regex: '(?i)^(readme|license|licence|changelog|contributing|security)(\.[a-z]+)?$'
            - basename_regex: '^\.(gitignore|gitattributes|editorconfig|hygienerc\.yml)$'
            - basename_regex: '^(CLAUDE|AGENTS|GEMINI)\.md$'
    suggests:
      - type: review

  - id: FS-BOUNDARY-001
    title: Frontera de proyecto con confianza insuficiente
    why: >
      El directorio tiene senales de proyecto, pero no suficientes. No se
      propone ninguna operacion sobre su contenido y su presencia impide
      declarar el workspace limpio hasta que una persona lo aclare.
    severity: info
    risk: unknown
    confidence: 1
    scope: project
    match:
      project_status: unknown-boundary
    suggests:
      - type: review

  - id: FS-GENERATED-001
    title: Directorio generado sin ignorar
    why: >
      Un node_modules, dist o .venv es reproducible y no debe versionarse.
      Nunca se pone en cuarentena: solo se comprueba que este ignorado.
    severity: medium
    risk: safe
    confidence: 0.9
    match:
      all:
        - is_dir: true
        - basename_regex: '^(node_modules|dist|build|target|coverage|\.venv|venv|__pycache__|\.next)$'
        - in_git_repo: true
        - ignored_by_git: false
    suggests:
      - type: ignore
      - type: review

  - id: FS-EMPTY-001
    title: Directorio vacio
    why: Un directorio vacio no aporta nada y Git ni siquiera lo conserva.
    severity: info
    risk: safe
    confidence: 0.7
    match:
      all:
        - is_dir: true
        - is_symlink: false
        - is_empty: true
    suggests:
      - type: review
```

- [ ] **Step 4: Añadir al final de `rules/ai.yml`**

```yaml

  - id: AI-DOC-001
    title: Fichero de instrucciones de agente duplicado
    why: >
      Dos ficheros de instrucciones identicos en niveles distintos se
      desincronizan en cuanto se edita uno. Detectar instrucciones en
      conflicto es semantico y queda para la capa de IA.
    severity: low
    risk: low
    confidence: 0.7
    match:
      all:
        - is_file: true
        - basename_regex: '^((CLAUDE|AGENTS|GEMINI)\.md|\.cursorrules|copilot-instructions\.md)$'
        - sha256_duplicate: true
    suggests:
      - type: review

  - id: AI-REPORT-001
    title: Informe generado que nada referencia
    why: >
      Los agentes dejan informes de una sola lectura. Si nada los referencia,
      suelen ser residuo de una sesion.
    severity: low
    risk: low
    confidence: 0.6
    match:
      all:
        - is_file: true
        - basename_regex: '(?i)(^|[-_ ])(report|informe|summary)([-_ ][^.]*)?\.(md|html|txt)$'
        - referenced_by_source: false
        - none:
            - glob: "docs/**"
            - glob: ".tmp/**"
    suggests:
      - type: review

  - id: AI-OUTSIDE-001
    title: Directorio de agente fuera de todo proyecto
    why: >
      Un .claude o .cursor en la raiz de un workspace, fuera de cualquier
      proyecto, suele venir de abrir el agente en la carpeta equivocada.
    severity: low
    risk: low
    confidence: 0.7
    match:
      all:
        - root_is_workspace: true
        - is_dir: true
        - in_project: false
        - none:
            - depth_gt: 1
        - basename_regex: '^\.(claude|cursor|aider[^/]*|continue|codex|gemini|windsurf)$'
    suggests:
      - type: review

  - id: AI-DUPDOC-001
    title: Documentacion que duplica el README
    why: >
      Un documento casi identico al README del mismo directorio suele ser una
      version generada que se quedo atras.
    severity: low
    risk: medium
    confidence: 0.6
    match:
      all:
        - is_file: true
        - glob: "**/*.md"
        - none:
            - basename_regex: '(?i)^readme\.md$'
        - similar_to_readme_gt: 0.8
    suggests:
      - type: review
```

- [ ] **Step 5: Ejecutar los tests**

Run: `npx vitest run tests/rules/`
Expected: PASS. Los packs siguen validando contra el schema y ningún ID se
repite.

- [ ] **Step 6: Commitear**

```bash
git add rules/filesystem.yml rules/ai.yml tests/rules/reglas-v1-fs-ai.test.ts
git commit -m "feat: reglas FS-ROOT, FS-BOUNDARY, FS-GENERATED, FS-EMPTY, AI-DOC, AI-REPORT, AI-OUTSIDE y AI-DUPDOC"
```

---

## Task 8: Reglas nuevas de Git y de seguridad

**Files:**
- Modify: `rules/git.yml`, `rules/security.yml`
- Test: `tests/rules/reglas-v1-git-sec.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const run = promisify(execFile);
const RULES = path.join(process.cwd(), 'rules');
const OLD = '2020-01-01T00:00:00';
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-r3g-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function file(rel: string, content = 'x'): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content);
}
async function git(args: string[], date?: string): Promise<void> {
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env;
  await run('git', args, { cwd: root, env });
}
async function repo(): Promise<void> {
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@t.t']);
  await git(['config', 'user.name', 'T']);
}
async function commit(rel: string, content = 'x', date?: string): Promise<void> {
  await file(rel, content);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', `c ${rel}`], date);
}
async function audit() {
  return runAudit({ root, rulesDir: RULES });
}
async function hallazgos(rule: string): Promise<string[]> {
  return (await audit()).findings.filter((f) => f.ruleId === rule).map((f) => f.path).sort();
}

describe('reglas de git', () => {
  it('GIT-NOREPO-001: proyecto con manifiesto y sin repositorio', async () => {
    await file('app/package.json', '{}');
    expect(await hallazgos('GIT-NOREPO-001')).toEqual(['app']);
  });

  it('GIT-IGNORE-001: repositorio sin .gitignore', async () => {
    await repo();
    expect(await hallazgos('GIT-IGNORE-001')).toEqual(['.']);
    await file('.gitignore', 'dist/\n');
    expect(await hallazgos('GIT-IGNORE-001')).toEqual([]);
  });

  it('GIT-WORKTREE-001: .git que apunta a un gitdir inexistente', async () => {
    await file('.git', 'gitdir: ./no/existe\n');
    expect(await hallazgos('GIT-WORKTREE-001')).toEqual(['.']);
  });

  it('GIT-STASH-001: stash antiguo', async () => {
    await repo();
    await commit('a.txt', 'uno');
    await file('a.txt', 'dos');
    await git(['stash', '-q'], OLD);
    expect(await hallazgos('GIT-STASH-001')).toEqual(['.']);
  });

  it('GIT-BRANCH-001: rama huerfana sin actividad', async () => {
    await repo();
    await commit('a.txt', 'uno');
    await git(['checkout', '-q', '-b', 'vieja']);
    await commit('b.txt', 'dos', OLD);
    await git(['checkout', '-q', 'main']);
    expect(await hallazgos('GIT-BRANCH-001')).toEqual(['.']);
  });
});

describe('reglas de seguridad', () => {
  it('SEC-HIST-001: secreto en el historico aunque ya no este en el arbol', async () => {
    await repo();
    await commit('.env', 'K=v');
    await git(['rm', '-q', '.env']);
    await git(['commit', '-q', '-m', 'borra']);
    expect(await hallazgos('SEC-HIST-001')).toEqual(['.']);
  });

  it('SEC-HIST-001 ignora un .env.example', async () => {
    await repo();
    await commit('.env.example', 'K=');
    expect(await hallazgos('SEC-HIST-001')).toEqual([]);
  });

  it('SEC-HIST-001 con historial truncado da RULE_EXECUTION_LIMIT, no limpio', async () => {
    await repo();
    await commit('a.txt', '1');
    await commit('b.txt', '2');
    const result = await runAudit({ root, rulesDir: RULES, limits: { maxGitHistoryCommits: 1 } });
    expect(result.limits).toContainEqual({ ruleId: 'SEC-HIST-001', limit: 'max_git_history_commits' });
    expect(result.score.clean).toBe(false);
  });

  it('SEC-DB-001: volcado versionado fuera de fixtures', async () => {
    await repo();
    await commit('backup/dump.sql', 'CREATE TABLE t (id int);');
    await commit('tests/fixtures/db.sql', 'CREATE TABLE t (id int);');
    expect(await hallazgos('SEC-DB-001')).toEqual(['backup/dump.sql']);
  });

  it.runIf(process.platform !== 'win32')('SEC-PERM-001: clave privada legible por otros', async () => {
    await file('id_rsa', 'k');
    await chmod(path.join(root, 'id_rsa'), 0o644);
    expect(await hallazgos('SEC-PERM-001')).toEqual(['id_rsa']);
    await chmod(path.join(root, 'id_rsa'), 0o600);
    expect(await hallazgos('SEC-PERM-001')).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('SEC-PERM-001 en Windows se reporta como unsupported', async () => {
    await file('id_rsa', 'k');
    const result = await audit();
    expect(result.findings.some((f) => f.ruleId === 'SEC-PERM-001')).toBe(false);
    expect(result.unsupported?.some((u) => u.ruleId === 'SEC-PERM-001')).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/rules/reglas-v1-git-sec.test.ts`
Expected: FAIL.

- [ ] **Step 3: Añadir al final de `rules/git.yml`**

```yaml

  - id: GIT-NOREPO-001
    title: Proyecto con codigo y sin repositorio
    why: Un proyecto con manifiesto y sin control de versiones pierde su historia en cuanto se rompe algo.
    severity: medium
    risk: low
    confidence: 0.8
    scope: project
    match:
      all:
        - has_child: [package.json, pyproject.toml, Cargo.toml, go.mod, pom.xml, composer.json]
        - in_git_repo: false
    suggests:
      - type: review

  - id: GIT-IGNORE-001
    title: Repositorio sin .gitignore
    why: Sin .gitignore, el primer git add -A versiona dependencias, builds y secretos.
    severity: low
    risk: safe
    confidence: 0.9
    scope: project
    match:
      all:
        - is_git_repo: true
        - none:
            - has_child: [.gitignore]
    suggests:
      - type: create
      - type: review

  - id: GIT-WORKTREE-001
    title: Worktree sin repositorio padre
    why: >
      Un .git que apunta a un gitdir que ya no existe deja el directorio fuera
      de control de versiones aunque parezca un repositorio.
    severity: medium
    risk: unknown
    confidence: 0.9
    scope: project
    match:
      git_worktree_orphan: true
    suggests:
      - type: review

  - id: GIT-STASH-001
    title: Stash antiguo
    why: Un stash olvidado durante semanas es trabajo que nadie recuerda tener.
    severity: low
    risk: high
    confidence: 0.8
    scope: project
    match:
      all:
        - is_git_repo: true
        - git_stash_older_than: 30d
    suggests:
      - type: review

  - id: GIT-BRANCH-001
    title: Rama inactiva
    why: >
      Una rama ya fusionada y sin actividad (stale) o una rama sin upstream ni
      fusion y sin actividad (orphaned). Nunca se propone tocar una rama: la
      accion es siempre revisar.
    severity: low
    risk: high
    confidence: 0.7
    scope: project
    match:
      all:
        - is_git_repo: true
        - any:
            - git_branch_stale: 90d
            - git_branch_orphaned: 90d
    suggests:
      - type: review
```

- [ ] **Step 4: Añadir al final de `rules/security.yml`**

```yaml

  - id: SEC-DB-001
    title: Volcado de base de datos versionado
    why: >
      Un volcado versionado fuera de fixtures o migraciones suele contener datos
      reales. Un volcado no es malo por existir: se pondera ubicacion, version
      y referencias.
    severity: high
    risk: high
    confidence: 0.6
    match:
      all:
        - is_file: true
        - any:
            - glob: "**/*.sql"
            - glob: "**/*.dump"
            - glob: "**/*.sqlite"
            - glob: "**/*.sqlite3"
            - glob: "**/*.db"
        - tracked_by_git: true
        - referenced_by_source: false
        - none:
            - glob: "**/test/**"
            - glob: "**/tests/**"
            - glob: "**/fixtures/**"
            - glob: "**/__fixtures__/**"
            - glob: "**/spec/**"
            - glob: "**/migrations/**"
    suggests:
      - type: review

  - id: SEC-PERM-001
    title: Clave privada con permisos abiertos
    why: >
      Una clave privada legible por grupo u otros puede leerla cualquier
      proceso de la maquina. En Windows se reporta como no soportado.
    severity: high
    risk: low
    confidence: 0.8
    match:
      all:
        - is_file: true
        - any:
            - basename_regex: '^id_(rsa|dsa|ecdsa|ed25519)$'
            - glob: "**/*.pem"
            - glob: "**/*.key"
        - mode_too_open: true
    suggests:
      - type: review

  - id: SEC-HIST-001
    title: Secreto en el historico de Git
    why: >
      Un secreto que estuvo versionado sigue en el historico aunque se borre
      del arbol. La herramienta nunca reescribe historia: hay que rotar el
      secreto.
    severity: critical
    risk: high
    confidence: 0.7
    scope: project
    match:
      all:
        - is_git_repo: true
        - in_git_history:
            paths: ["**/.env", "**/.env.*", "**/id_rsa", "**/id_dsa", "**/id_ecdsa", "**/id_ed25519", "**/*.pem", "**/*.key"]
            except: ["**/.env.example", "**/.env.sample"]
    suggests:
      - type: review
```

- [ ] **Step 5: Ejecutar toda la suite**

Run: `npm run typecheck && npm test`
Expected: PASS, salvo el snapshot dorado si ya cambió; ese se actualiza en la
tarea 9. Si falla algo más, se diagnostica antes de seguir.

- [ ] **Step 6: Commitear**

```bash
git add rules/git.yml rules/security.yml tests/rules/reglas-v1-git-sec.test.ts
git commit -m "feat: reglas GIT-NOREPO, GIT-IGNORE-001, GIT-WORKTREE, GIT-STASH, GIT-BRANCH, SEC-DB, SEC-PERM y SEC-HIST"
```

---

## Task 9: Fixture dorado, autoauditoría y catálogo de reglas

**Files:**
- Modify: `tests/golden/__snapshots__/golden.test.ts.snap`, `README.md`

- [ ] **Step 1: Actualizar el snapshot y revisar el cambio**

Run: `npx vitest run tests/golden -u`, y después
`git diff tests/golden/__snapshots__/golden.test.ts.snap`.

Expected: la lista de reglas de `examples/before` pasa a ser exactamente:

```
AI-SCRATCH-001, AI-SCRIPT-001, FS-DUP-001, FS-NAMING-001, FS-ROOT-001, GIT-NOREPO-001, SEC-CERT-001
```

`FS-ROOT-001` aparece porque la raíz es un workspace con `proyecto-a` y tiene
ficheros sueltos. `GIT-NOREPO-001` aparece porque `proyecto-a` tiene
`package.json` y ningún repositorio. Si la lista difiere, no se acepta el
snapshot: se investiga qué regla dispara de más o de menos.

- [ ] **Step 2: Autoauditoría**

Run: `npm run build && npm run dogfood`
Expected: `Estado: LIMPIO` en `src` y en `rules`. Si una regla nueva dispara
sobre el código propio, se corrige el código o la regla con un test que
justifique el cambio, nunca con una exclusión (NN-5).

- [ ] **Step 3: Catálogo del README**

En `README.md`, sección `## Reglas disponibles`: cambiar "16 reglas" por "32
reglas" y añadir estas filas a las tablas de su eje.
- **Ficheros:** `FS-ROOT-001` Fichero suelto en la raíz del workspace;
  `FS-BOUNDARY-001` Frontera de proyecto con confianza insuficiente;
  `FS-GENERATED-001` Directorio generado sin ignorar; `FS-EMPTY-001`
  Directorio vacío.
- **Git:** `GIT-NOREPO-001` Proyecto con código y sin repositorio;
  `GIT-IGNORE-001` Repositorio sin .gitignore; `GIT-WORKTREE-001` Worktree sin
  repositorio padre; `GIT-STASH-001` Stash antiguo; `GIT-BRANCH-001` Rama
  inactiva.
- **Seguridad:** `SEC-DB-001` Volcado de base de datos versionado;
  `SEC-PERM-001` Clave privada con permisos abiertos; `SEC-HIST-001` Secreto
  en el histórico de Git.
- **Agentes:** `AI-DOC-001` Fichero de instrucciones de agente duplicado;
  `AI-REPORT-001` Informe generado que nada referencia; `AI-OUTSIDE-001`
  Directorio de agente fuera de todo proyecto; `AI-DUPDOC-001` Documentación
  que duplica el README.

Debajo de las tablas, añadir:

```markdown
Las reglas de proyecto (`scope: project`) se evalúan una vez por proyecto
detectado, incluida la raíz. `SEC-PERM-001` se reporta como no soportada en
Windows, sin restar puntos ni bloquear el estado limpio.
```

- [ ] **Step 4: Verificación completa de la parte A**

Run: `npm run typecheck && npm test && npm run build && npm run dogfood`
Expected: todo en verde.

- [ ] **Step 5: Commitear**

```bash
git add tests/golden/__snapshots__/golden.test.ts.snap README.md
git commit -m "test: fixture dorado con las reglas de proyecto; README con el catalogo de 32 reglas"
```

**Fin de la parte A.** Aquí se abre el primer PR.

---

# PARTE B — Prevención y loop

## Task 10: Edición registrada y reversible

**Files:**
- Create: `src/executor/edit.ts`
- Modify: `src/executor/manifest.ts`, `src/executor/restore.ts`
- Test: `tests/executor/edit.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyEdit, fingerprintText, ABSENT } from '../../src/executor/edit.js';
import { findEntries, readManifest } from '../../src/executor/manifest.js';
import { restoreEntry } from '../../src/executor/restore.js';
import { HomeInsideWorkspaceError } from '../../src/core/home.js';

const DIA = new Date('2026-10-12T10:00:00.000Z');
const existe = (p: string) => access(p).then(() => true, () => false);
let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-ed-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const append = (line: string) => (cur: string | null) => `${cur ?? ''}${line}\n`;
const edit = (extra: Partial<Parameters<typeof applyEdit>[0]> = {}) => applyEdit({
  root, home, opId: 'OP-000001', file: '.gitignore', transform: append('/dist/'),
  ruleIds: ['FS-GENERATED-001'], reason: 'r', now: DIA, ...extra,
});

describe('applyEdit', () => {
  it('crea el fichero si no existe y lo registra como edicion', async () => {
    const r = await edit();
    expect(r).toMatchObject({ status: 'applied', created: true, entry: '2026-10-12/OP-000001' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('/dist/\n');
    const m = await readManifest(path.join(home, 'quarantine', '2026-10-12', 'OP-000001'));
    expect(m).toMatchObject({ kind: 'edit', state: 'quarantined', edit: { before_sha256: null, after_sha256: fingerprintText('/dist/\n') } });
  });

  it('guarda una copia del original antes de modificar', async () => {
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    const r = await edit();
    expect(r).toMatchObject({ status: 'applied', created: false });
    const m = await readManifest(path.join(home, 'quarantine', '2026-10-12', 'OP-000001'));
    expect(await readFile(m.quarantine_path, 'utf8')).toBe('node_modules/\n');
  });

  it('no registra nada si la transformacion no cambia el fichero', async () => {
    await writeFile(path.join(root, '.gitignore'), 'x\n');
    expect(await edit({ transform: (c) => c ?? '' })).toMatchObject({ status: 'unchanged' });
    expect(await existe(path.join(home, 'quarantine'))).toBe(false);
  });

  it('omite la edicion si el fichero cambio desde la aprobacion', async () => {
    await writeFile(path.join(root, '.gitignore'), 'otro\n');
    expect(await edit({ expectedBefore: ABSENT })).toMatchObject({ status: 'skipped' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('otro\n');
  });

  it('se niega si la base cae dentro del workspace', async () => {
    await expect(edit({ home: path.join(root, '.hygiene') })).rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });
});

describe('restore de una edicion', () => {
  it('devuelve el contenido original', async () => {
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    await edit();
    const [e] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(e!)).toMatchObject({ status: 'restored' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
  });

  it('un fichero creado por hygiene se aparta a la entrada, no se borra', async () => {
    await edit();
    const [e] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(e!)).toMatchObject({ status: 'restored' });
    expect(await existe(path.join(root, '.gitignore'))).toBe(false);
    expect(await readFile(path.join(e!.dir, 'created', '.gitignore'), 'utf8')).toBe('/dist/\n');
  });

  it('aborta sin tocar nada si el fichero cambio despues de la edicion', async () => {
    await edit();
    await writeFile(path.join(root, '.gitignore'), 'editado a mano\n');
    const [e] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(e!)).toMatchObject({ status: 'aborted' });
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('editado a mano\n');
  });

  it('las entradas INIT- se encuentran por su referencia', async () => {
    await edit({ opId: 'INIT-000001' });
    expect((await findEntries(home, 'INIT-000001')).map((e) => e.entry)).toEqual(['2026-10-12/INIT-000001']);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/executor/edit.test.ts`
Expected: FAIL, no se puede resolver `src/executor/edit.js`.

- [ ] **Step 3: Ampliar el manifiesto en `src/executor/manifest.ts`**

1. Añadir a la interfaz `Manifest`, después de
   `restore_report: { permissions: PermissionRestore } | null;`:

```ts
  /** Ausente en manifiestos del plan 2: equivale a 'quarantine'. */
  kind?: 'quarantine' | 'edit';
  /**
   * Solo en ediciones. En ellas, quarantine_path es la copia previa ('' si el
   * fichero no existia), sha256 es la huella posterior y source el fichero
   * editado. El estado 'quarantined' significa "aplicada".
   */
  edit?: { before_sha256: string | null; after_sha256: string } | null;
```

2. Sustituir las dos expresiones regulares por:

```ts
const OP_REF = /^(OP|INIT)-\d{6}$/;
// Formato cerrado: impide que una referencia con '..' salga de la cuarentena.
const ENTRY_REF = /^\d{4}-\d{2}-\d{2}\/(OP|INIT)-\d{6}(-\d+)?$/;
```

y en el mensaje de `InvalidEntryRefError` cambiar
`Usa OP-000123 o AAAA-MM-DD/OP-000123` por
`Usa OP-000123, INIT-000001 o AAAA-MM-DD/OP-000123`.

- [ ] **Step 4: Implementar `src/executor/edit.ts`**

```ts
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertHomeOutside } from '../core/home.js';
import { capturePermissions } from './permissions.js';
import { allocateEntry, writeManifest, type Manifest } from './manifest.js';

/** Huella de un fichero que no existe. */
export const ABSENT = 'absent';

export function fingerprintText(content: string | null): string {
  return content === null ? ABSENT : createHash('sha256').update(content).digest('hex');
}

export async function readTextOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Escribe en un temporal del mismo directorio y renombra: nunca deja un fichero a medias. */
export async function writeTextAtomic(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.hygiene-tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, abs);
}

export interface EditRequest {
  root: string;
  home: string;
  opId: string;
  /** Ruta relativa al root, con separador '/'. */
  file: string;
  transform(current: string | null): string;
  /** Huella aprobada; si el fichero ya no la tiene, no se edita. */
  expectedBefore?: string;
  mode?: number;
  ruleIds: string[];
  reason: string;
  now?: Date;
}

export type EditOutcome =
  | { status: 'applied'; opId: string; path: string; entry: string; after: string; created: boolean }
  | { status: 'unchanged'; opId: string; path: string }
  | { status: 'skipped'; opId: string; path: string; reason: string }
  | { status: 'failed'; opId: string; path: string; reason: string };

/**
 * Edicion registrada (decision 10): copia del original en payload/, manifiesto
 * pending antes de escribir y huellas antes/despues para que restore solo
 * deshaga si nadie ha tocado el fichero despues.
 */
export async function applyEdit(req: EditRequest): Promise<EditOutcome> {
  const base = { opId: req.opId, path: req.file };
  await assertHomeOutside(req.home, req.root);
  const abs = path.join(req.root, req.file);
  const current = await readTextOrNull(abs);
  const before = fingerprintText(current);
  if (req.expectedBefore !== undefined && before !== req.expectedBefore) {
    return { status: 'skipped', ...base, reason: 'el fichero ha cambiado desde la aprobacion' };
  }
  const next = req.transform(current);
  if (next === current) return { status: 'unchanged', ...base };

  const now = req.now ?? new Date();
  const { entry, dir } = await allocateEntry(req.home, req.opId, now);
  let backup = '';
  if (current !== null) {
    await mkdir(path.join(dir, 'payload'));
    backup = path.join(dir, 'payload', path.basename(abs));
    await writeFile(backup, current, 'utf8');
  }
  const after = fingerprintText(next);
  const manifest: Manifest = {
    schema_version: 1,
    operation_id: req.opId,
    entry,
    state: 'pending',
    created_at: now.toISOString(),
    restored_at: null,
    root: req.root,
    relative_path: req.file,
    source: abs,
    quarantine_path: backup,
    sha256: after,
    size: Buffer.byteLength(next),
    platform: process.platform,
    permissions: current !== null
      ? await capturePermissions(abs, dir)
      : { model: 'none', captured: false, data: null },
    rule_ids: req.ruleIds,
    reason: req.reason,
    restorable: true,
    restore_report: null,
    kind: 'edit',
    edit: { before_sha256: current === null ? null : before, after_sha256: after },
  };
  await writeManifest(dir, manifest);

  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeTextAtomic(abs, next);
    if (req.mode !== undefined) await chmod(abs, req.mode);
  } catch (err) {
    return { status: 'failed', ...base, reason: err instanceof Error ? err.message : String(err) };
  }

  await writeManifest(dir, { ...manifest, state: 'quarantined' });
  return { status: 'applied', ...base, entry, after, created: current === null };
}
```

- [ ] **Step 5: Restaurar ediciones en `src/executor/restore.ts`**

Añadir las importaciones:

```ts
import { readFile } from 'node:fs/promises';
import { fingerprintText, readTextOrNull, writeTextAtomic } from './edit.js';
```

Añadir esta función antes de `restoreEntry`:

```ts
async function restoreEdit(e: QuarantineEntry, now: Date): Promise<RestoreOutcome> {
  const m = e.manifest;
  const edit = m.edit;
  const abort = (reason: string): RestoreOutcome => ({ status: 'aborted', entry: e.entry, reason });

  if (m.state === 'restored') return abort('la entrada ya se restauro');
  if (!edit) return abort('manifiesto de edicion sin datos de edicion');
  const current = await readTextOrNull(m.source);
  if (fingerprintText(current) !== edit.after_sha256) {
    return abort(m.state === 'pending'
      ? 'la edicion no llego a aplicarse: el fichero sigue como estaba'
      : 'el fichero cambio despues de la edicion; no se sobrescribe');
  }

  let permissions: PermissionRestore = 'restored';
  if (edit.before_sha256 === null) {
    // Lo creo hygiene: se aparta a la entrada en vez de borrarlo.
    await mkdir(path.join(e.dir, 'created'), { recursive: true });
    await moveFile(m.source, path.join(e.dir, 'created', path.basename(m.source)), edit.after_sha256);
  } else {
    const original = await readFile(m.quarantine_path, 'utf8');
    if (fingerprintText(original) !== edit.before_sha256) {
      return abort('la copia previa no coincide con su huella');
    }
    await writeTextAtomic(m.source, original);
    permissions = await applyPermissions(m.source, e.dir, m.permissions);
  }

  await writeManifest(e.dir, {
    ...m, state: 'restored', restored_at: now.toISOString(), restore_report: { permissions },
  });
  return { status: 'restored', entry: e.entry, source: m.source, permissions };
}
```

Y como primera línea del cuerpo de `restoreEntry`:

```ts
  if (e.manifest.kind === 'edit') return restoreEdit(e, now);
```

- [ ] **Step 6: Ejecutar los tests del executor**

Run: `npx vitest run tests/executor/`
Expected: PASS, también los tests anteriores de cuarentena y restore.

- [ ] **Step 7: Commitear**

```bash
git add src/executor/edit.ts src/executor/manifest.ts src/executor/restore.ts tests/executor/edit.test.ts
git commit -m "feat: edicion de ficheros registrada en el journal y reversible con restore"
```

---

## Task 11: `ignore` se planifica como operación ejecutable

**Files:**
- Modify: `src/core/types.ts`, `src/planner/plan.ts`, `src/plan.ts`, `src/report/plan.ts`
- Test: `tests/planner/plan.test.ts`, `tests/planner/run-plan.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/planner/plan.test.ts`:

1. Cambiar el test `solo quarantine es ejecutable en esta version` por:

```ts
  it('quarantine e ignore son ejecutables; create y move no', () => {
    expect([...EXECUTABLE_TYPES].sort()).toEqual(['ignore', 'quarantine']);
  });
```

2. Añadir:

```ts
  it('ignore lleva destino, linea y la huella del .gitignore', () => {
    const f = hallazgo('node_modules', { ruleId: 'FS-GENERATED-001', suggests: ['ignore', 'review'] });
    const input = entradaPlanner([f], {
      ignoreTargets: new Map([['node_modules', { file: '.gitignore', line: '/node_modules/', fingerprint: 'absent', tracked: false }]]),
    });
    input.inventory.files = [entrada('node_modules', { isDir: true })];
    expect(planOperations(input)[0]).toMatchObject({
      type: 'ignore', edit: { file: '.gitignore', line: '/node_modules/' }, source: { sha256: 'absent' },
    });
  });

  it('ignore fuera de un repo git se degrada a review', () => {
    const f = hallazgo('x', { suggests: ['ignore'] });
    expect(planOperations(entradaPlanner([f], { ignoreTargets: new Map([['x', null]]) }))[0])
      .toMatchObject({ type: 'review', degradeReason: 'not-in-git-repo' });
  });

  it('ignorar algo ya versionado no sirve y se degrada a review', () => {
    const f = hallazgo('x', { suggests: ['ignore'] });
    const input = entradaPlanner([f], {
      ignoreTargets: new Map([['x', { file: '.gitignore', line: '/x', fingerprint: 'absent', tracked: true }]]),
    });
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'tracked-ignore-ineffective' });
  });
```

En `tests/planner/run-plan.test.ts`, añadir las importaciones de `mkdir` y
`execFile`/`promisify` y este test:

```ts
  it('propone ignore para un node_modules sin ignorar en un repo', async () => {
    await promisify(execFile)('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'a.js'), 'x');
    const { plan } = await runPlan({ root, rulesDir: RULES });
    expect(plan.operations.find((o) => o.path === 'node_modules')).toMatchObject({
      type: 'ignore', edit: { file: '.gitignore', line: '/node_modules/' }, source: { sha256: 'absent' },
    });
  });
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/planner/`
Expected: FAIL.

- [ ] **Step 3: Tipos**

En `src/core/types.ts`:

1. En `DegradeReason`, añadir `| 'not-in-git-repo'` y
   `| 'tracked-ignore-ineffective'` antes del `;` final.
2. En `Operation`, añadir después de `source`:

```ts
  /** Solo en ignore: linea que se anade y a que fichero (relativo al root). */
  edit?: { file: string; line: string };
```

- [ ] **Step 4: Planner**

En `src/planner/plan.ts`:

1. Cambiar `EXECUTABLE_TYPES` por
   `new Set<OperationType>(['quarantine', 'ignore'])` y su comentario por
   `/** Tipos que el executor sabe aplicar. create solo lo hace init; move no lo propone ninguna regla. */`.
2. Añadir debajo de `DEFAULT_POLICY`:

```ts
export interface IgnoreTarget {
  file: string;
  line: string;
  /** Huella del .gitignore al planificar, o 'absent'. */
  fingerprint: string;
  /** La ruta, o algo debajo de ella, ya esta versionado. */
  tracked: boolean;
}
```

3. Añadir a `PlannerInput`:

```ts
  /** Destino de cada candidato a ignore; null si no esta en un repo git. */
  ignoreTargets?: Map<string, IgnoreTarget | null>;
```

4. En `resolve`, añadir justo antes del `return` final:

```ts
  if (primary === 'ignore') {
    const target = input.ignoreTargets?.get(f.path);
    if (!target) return degrade('not-in-git-repo');
    if (target.tracked) return degrade('tracked-ignore-ineffective');
  }
```

5. En `planOperations`, sustituir el `ops.push({ ... })` por:

```ts
    const target = r.type === 'ignore' ? input.ignoreTargets?.get(p) ?? null : null;
    ops.push({
      id: `OP-${String(ops.length + 1).padStart(6, '0')}`,
      type: r.type,
      path: p,
      findingIds: group.map((f) => f.id),
      ruleIds: [...new Set(group.map((f) => f.ruleId))],
      risk,
      reason: [...new Set(group.map((f) => f.reason))].join('; '),
      degradedFrom: r.degradedFrom,
      degradeReason: r.degradeReason,
      source: target
        ? { sha256: target.fingerprint, size: 0 }
        : { sha256: input.hashes.get(p) ?? null, size: byPath.get(p)?.size ?? 0 },
      ...(target ? { edit: { file: target.file, line: target.line } } : {}),
    });
```

- [ ] **Step 5: `runPlan` calcula los destinos**

En `src/plan.ts`, añadir las importaciones:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, Inventory } from './core/types.js';
import { gitKeyFor } from './collectors/workspace.js';
import { fingerprintText } from './executor/edit.js';
import type { IgnoreTarget } from './planner/plan.js';
```

Añadir antes de `runPlan`:

```ts
/**
 * Destino de un ignore (decision 9): el .gitignore del proyecto git que
 * contiene la ruta, siempre dentro del workspace auditado.
 */
async function ignoreTargetFor(inv: Inventory, byPath: Map<string, FileEntry>, p: string): Promise<IgnoreTarget | null> {
  const key = gitKeyFor(inv.gitByProject, p);
  if (key === null) return null;
  const g = inv.gitByProject[key]!;
  const rel = key === '.' ? p : p.slice(key.length + 1);
  const file = key === '.' ? '.gitignore' : `${key}/.gitignore`;
  const isDir = byPath.get(p)?.isDir ?? false;
  const tracked = g.trackedFiles.has(p) || [...g.trackedFiles].some((t) => t.startsWith(`${p}/`));
  let current: string | null = null;
  try {
    current = await readFile(path.join(inv.root, file), 'utf8');
  } catch {
    current = null;
  }
  return { file, line: `/${rel}${isDir ? '/' : ''}`, fingerprint: fingerprintText(current), tracked };
}
```

En `runPlan`, antes de `const policy`, añadir:

```ts
  const ignoreTargets = new Map<string, IgnoreTarget | null>();
  for (const f of result.findings) {
    if (f.suggests[0] !== 'ignore' || ignoreTargets.has(f.path)) continue;
    ignoreTargets.set(f.path, await ignoreTargetFor(result.inventory, byPath, f.path));
  }
```

y pasar `ignoreTargets,` dentro del objeto de `planOperations({ ... })`.

- [ ] **Step 6: Informe**

En `src/report/plan.ts`, dentro del `for`, después del `if` de
`degradedFrom`, añadir:

```ts
    if (op.edit) out.push(`             anade "${op.edit.line}" a ${op.edit.file}`);
```

- [ ] **Step 7: Ejecutar toda la suite**

Run: `npm run typecheck && npm test && npm run build && npm run dogfood`
Expected: todo en verde. El test de frontera de `approve` sigue verde: aprobar
un `ignore` solo escribe en `approvals/`.

- [ ] **Step 8: Commitear**

```bash
git add src/core/types.ts src/planner/plan.ts src/plan.ts src/report/plan.ts tests/planner/plan.test.ts tests/planner/run-plan.test.ts
git commit -m "feat: ignore se planifica como operacion ejecutable con destino y huella"
```

---

## Task 12: `clean` ejecuta `ignore`

**Files:**
- Create: `src/executor/ignore.ts`
- Modify: `src/clean.ts`, `src/cli/index.ts`
- Test: `tests/executor/ignore.test.ts`, `tests/e2e/ignore-round-trip.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

`tests/executor/ignore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { appendLine } from '../../src/executor/ignore.js';

describe('appendLine', () => {
  it('crea el contenido si no habia fichero', () => {
    expect(appendLine(null, '/dist/')).toBe('/dist/\n');
  });
  it('anade la linea respetando el salto final', () => {
    expect(appendLine('a\n', '/dist/')).toBe('a\n/dist/\n');
    expect(appendLine('a', '/dist/')).toBe('a\n/dist/\n');
  });
  it('no duplica una linea existente', () => {
    expect(appendLine('/dist/\r\nb\n', '/dist/')).toBe('/dist/\r\nb\n');
  });
});
```

`tests/e2e/ignore-round-trip.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';

const existe = (p: string) => access(p).then(() => true, () => false);
let base: string;
let root: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };
const prev = { home: process.env.HYGIENE_HOME, user: process.env.HYGIENE_USER_CONFIG };

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-ign-'));
  root = path.join(base, 'ws');
  await mkdir(root);
  process.env.HYGIENE_HOME = path.join(base, 'home');
  process.env.HYGIENE_USER_CONFIG = path.join(base, 'no-existe.yml');
  salida = [];
  await promisify(execFile)('git', ['init', '-q', '-b', 'main'], { cwd: root });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  if (prev.home === undefined) delete process.env.HYGIENE_HOME; else process.env.HYGIENE_HOME = prev.home;
  if (prev.user === undefined) delete process.env.HYGIENE_USER_CONFIG; else process.env.HYGIENE_USER_CONFIG = prev.user;
});

describe('ignore de punta a punta', () => {
  it('approve, clean y restore de dos ignore sobre el mismo .gitignore', async () => {
    for (const dir of ['node_modules', 'dist']) {
      await mkdir(path.join(root, dir));
      await writeFile(path.join(root, dir, 'a.js'), dir);
    }
    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(0);
    const gi = await readFile(path.join(root, '.gitignore'), 'utf8');
    expect(gi.split('\n').filter(Boolean).sort()).toEqual(['/dist/', '/node_modules/']);

    // Ya no queda nada que ignorar.
    salida = [];
    await main(['plan', root, '--json'], print);
    const plan = JSON.parse(salida.join('\n')) as { operations: { type: string }[] };
    expect(plan.operations.filter((o) => o.type === 'ignore')).toEqual([]);

    // Se deshace en orden inverso: la segunda edicion primero.
    expect(await main(['restore', 'OP-000002'], print)).toBe(0);
    expect(await main(['restore', 'OP-000001'], print)).toBe(0);
    expect(await existe(path.join(root, '.gitignore'))).toBe(false);
  });
});
```

Este test asume que el plan numera las operaciones por orden de ruta, así que
`dist` es `OP-000001` y `node_modules` es `OP-000002`. Por eso la primera
edición es la de `dist` y se deshace la segunda antes.

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/executor/ignore.test.ts tests/e2e/ignore-round-trip.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/executor/ignore.ts`**

```ts
import type { Operation } from '../core/types.js';
import { applyEdit, type EditOutcome } from './edit.js';

export function appendLine(current: string | null, line: string): string {
  const text = current ?? '';
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return text;
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}${line}\n`;
}

export interface IgnoreRequest {
  root: string;
  home: string;
  op: Operation;
  now?: Date;
  /** Huella esperada si otra operacion de este mismo clean ya edito el fichero. */
  expectedBefore?: string;
}

export async function ignoreOne(req: IgnoreRequest): Promise<EditOutcome> {
  const { op } = req;
  if (op.type !== 'ignore' || !op.edit || !op.source.sha256) {
    return { status: 'skipped', opId: op.id, path: op.path, reason: 'la operacion no es un ignore ejecutable' };
  }
  const { line } = op.edit;
  const outcome = await applyEdit({
    root: req.root,
    home: req.home,
    opId: op.id,
    file: op.edit.file,
    expectedBefore: req.expectedBefore ?? op.source.sha256,
    transform: (current) => appendLine(current, line),
    ruleIds: op.ruleIds,
    reason: op.reason,
    now: req.now,
  });
  return { ...outcome, path: op.path };
}
```

- [ ] **Step 4: Despachar en `src/clean.ts`**

Añadir las importaciones:

```ts
import { ignoreOne } from './executor/ignore.js';
import type { EditOutcome } from './executor/edit.js';
```

Añadir `export type ExecOutcome = QuarantineOutcome | EditOutcome;` debajo de
`CleanOptions`, cambiar en `CleanResult`
`{ status: 'executed'; outcomes: QuarantineOutcome[] }` por
`{ status: 'executed'; outcomes: ExecOutcome[] }`, y sustituir el bucle de
ejecución (desde `const outcomes: QuarantineOutcome[] = [];` hasta el cierre
del `for`) por:

```ts
  const outcomes: ExecOutcome[] = [];
  // Varias operaciones ignore pueden editar el mismo .gitignore en este
  // clean: cada una espera la huella que dejo la anterior, no la aprobada.
  const fingerprints = new Map<string, string>();
  for (const op of matched) {
    try {
      if (op.type === 'ignore' && op.edit) {
        const r = await ignoreOne({
          root: o.root, home: o.home, op, now: o.now, expectedBefore: fingerprints.get(op.edit.file),
        });
        if (r.status === 'applied') fingerprints.set(op.edit.file, r.after);
        outcomes.push(r);
      } else {
        outcomes.push(await quarantineOne({ root: o.root, home: o.home, op, now: o.now }));
      }
    } catch (err) {
      outcomes.push({
        status: 'failed', opId: op.id, path: op.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
```

- [ ] **Step 5: Mostrar los nuevos estados en `src/cli/index.ts`**

En el bloque `clean`, sustituir el bucle `for (const o of result.outcomes) { ... }`
por:

```ts
      for (const o of result.outcomes) {
        if (o.status === 'quarantined') print(`  cuarentena  ${o.opId}  ${o.path}  -> ${o.entry}`);
        else if (o.status === 'applied') print(`  ignorado    ${o.opId}  ${o.path}  -> ${o.entry}`);
        else if (o.status === 'unchanged') print(`  sin cambios ${o.opId}  ${o.path}`);
        else {
          if (o.status === 'failed') failed += 1;
          print(`  ${o.status === 'failed' ? 'fallo' : 'omitida'}  ${o.opId}  ${o.path}  (${o.reason})`);
        }
      }
```

y en `USAGE` cambiar la descripción de `clean --approved` por
`Ejecuta lo aprobado: cuarentena e ignore`.

- [ ] **Step 6: Ejecutar toda la suite**

Run: `npm run typecheck && npm test && npm run build && npm run dogfood`
Expected: todo en verde.

- [ ] **Step 7: Commitear**

```bash
git add src/executor/ignore.ts src/clean.ts src/cli/index.ts tests/executor/ignore.test.ts tests/e2e/ignore-round-trip.test.ts
git commit -m "feat: clean ejecuta ignore sobre el .gitignore del proyecto, reversible con restore"
```

---

## Task 13: `audit --axis` y `--fail-on`

**Files:**
- Modify: `src/audit.ts`, `src/cli/index.ts`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir dentro del `describe('main', ...)` de `tests/cli/cli.test.ts`:

```ts
  it('audit --axis security solo evalua el eje de seguridad', async () => {
    await writeFile(path.join(root, 'notas-final.md'), 'x');
    await writeFile(path.join(root, 'server.crt'), 'x');
    expect(await main(['audit', root, '--json', '--axis', 'security'], print)).toBe(0);
    const r = JSON.parse(salida.join('\n')) as { findings: { axis: string }[] };
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.axis === 'security')).toBe(true);
  });

  it('--fail-on high devuelve 1 solo si hay un hallazgo de esa severidad o mayor', async () => {
    await writeFile(path.join(root, 'server.crt'), 'x');
    expect(await main(['audit', root, '--axis', 'security', '--fail-on', 'high'], print)).toBe(0);
    await writeFile(path.join(root, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----');
    expect(await main(['audit', root, '--axis', 'security', '--fail-on', 'high'], print)).toBe(1);
  });

  it('un eje o una severidad invalidos devuelven 2', async () => {
    expect(await main(['audit', root, '--axis', 'red'], print)).toBe(2);
    expect(await main(['audit', root, '--fail-on', 'grave'], print)).toBe(2);
  });
```

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: FAIL, `parseArgs` rechaza `--axis`.

- [ ] **Step 2: Filtrar packs en `src/audit.ts`**

Añadir a `AuditOptions`:

```ts
  /** Solo se cargan los packs de estos ejes. */
  axes?: Axis[];
```

(añadir `Axis` a la importación de tipos de `./core/types.js`) y en
`collectAudit` sustituir
`const packs = await loadPacks(options.rulesDir);` por:

```ts
  const packs = (await loadPacks(options.rulesDir))
    .filter((p) => !options.axes || options.axes.includes(p.axis));
```

- [ ] **Step 3: Opciones en la CLI**

En `src/cli/index.ts`:

1. Añadir a `options` de `parseArgs`: `axis: { type: 'string' },` y
   `'fail-on': { type: 'string' },`.
2. Añadir las importaciones de tipos
   `import type { Axis, Severity } from '../core/types.js';` y estas constantes
   debajo de `RULES_DIR`:

```ts
const AXES: Axis[] = ['filesystem', 'git', 'security', 'ai'];
const SEVERITIES: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
```

3. Sustituir el bloque `scan`/`audit` por:

```ts
    if (command === 'scan' || command === 'audit') {
      const root = await resolveDir(target, print);
      if (!root) return 2;

      const axis = parsed.values.axis;
      if (axis !== undefined && !(AXES as string[]).includes(axis)) {
        print(`--axis no valido: ${axis}. Valores: ${AXES.join(', ')}`);
        return 2;
      }
      const failOn = parsed.values['fail-on'];
      if (failOn !== undefined && !(SEVERITIES as string[]).includes(failOn)) {
        print(`--fail-on no valido: ${failOn}. Valores: ${SEVERITIES.join(', ')}`);
        return 2;
      }

      const result = await runAudit({
        ...engineOptions(root, await loadConfig(root)),
        axes: axis ? [axis as Axis] : undefined,
      });

      if (command === 'scan') {
        print(JSON.stringify(result.inventory, replacer, 2));
        return 0;
      }

      print(json ? JSON.stringify(result, replacer, 2) : renderReport(result));
      if (failOn !== undefined) {
        const threshold = SEVERITIES.indexOf(failOn as Severity);
        return result.findings.some((f) => SEVERITIES.indexOf(f.severity) >= threshold) ? 1 : 0;
      }
      return result.score.clean ? 0 : 1;
    }
```

4. En `USAGE`, añadir a `Opciones`:

```
  --axis <eje>           audit: solo un eje (filesystem, git, security, ai)
  --fail-on <severidad>  audit: sale con 1 si hay hallazgos de esa severidad o mayor
```

- [ ] **Step 4: Ejecutar toda la suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commitear**

```bash
git add src/audit.ts src/cli/index.ts tests/cli/cli.test.ts
git commit -m "feat: audit --axis y --fail-on para el hook de pre-commit y CI"
```

---

## Task 14: Plantillas y núcleo de `hygiene init`

**Files:**
- Create: `templates/gitignore/common.txt`, `node.txt`, `python.txt`, `rust.txt`, `go.txt`, `java.txt`, `dotnet.txt`, `templates/agents.md`, `templates/hygienerc.yml`, `src/init/blocks.ts`, `src/init/templates.ts`, `src/init/run.ts`
- Modify: `src/cli/index.ts`, `package.json`
- Test: `tests/init/blocks.test.ts`, `tests/init/run.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

`tests/init/blocks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { replaceBlock } from '../../src/init/blocks.js';

const S = '# >>> hygiene';
const E = '# <<< hygiene';

describe('replaceBlock', () => {
  it('crea el bloque si no habia fichero', () => {
    expect(replaceBlock(null, S, E, 'a\nb')).toBe(`${S}\na\nb\n${E}\n`);
  });
  it('anade el bloque al final conservando lo existente', () => {
    expect(replaceBlock('mio\n', S, E, 'a')).toBe(`mio\n\n${S}\na\n${E}\n`);
  });
  it('sustituye un bloque existente', () => {
    const before = `mio\n\n${S}\nviejo\n${E}\nfinal\n`;
    expect(replaceBlock(before, S, E, 'nuevo')).toBe(`mio\n\n${S}\nnuevo\n${E}\nfinal\n`);
  });
  it('es idempotente', () => {
    const once = replaceBlock('mio\n', S, E, 'a');
    expect(replaceBlock(once, S, E, 'a')).toBe(once);
  });
});
```

`tests/init/run.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInit } from '../../src/init/run.js';
import { loadConfig } from '../../src/config/load.js';
import { findEntries } from '../../src/executor/manifest.js';
import { restoreEntry } from '../../src/executor/restore.js';

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-init-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
  await writeFile(path.join(root, 'package.json'), '{}');
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const leer = (rel: string) => readFile(path.join(root, rel), 'utf8');
const status = (actions: { file: string; status: string }[]) =>
  Object.fromEntries(actions.map((a) => [a.file, a.status]));

describe('runInit', () => {
  it('prepara un proyecto node nuevo', async () => {
    const actions = await runInit({ root, home });
    expect(status(actions)).toMatchObject({ '.gitignore': 'created', '.tmp/': 'created', '.hygienerc.yml': 'created' });
    const gi = await leer('.gitignore');
    expect(gi).toContain('# >>> hygiene');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('.tmp/');
    expect((await stat(path.join(root, '.tmp'))).isDirectory()).toBe(true);
    await expect(loadConfig(root, path.join(base, 'no.yml'))).resolves.toBeDefined();
  });

  it('una segunda ejecucion no cambia nada', async () => {
    await runInit({ root, home });
    const again = await runInit({ root, home });
    expect(again.filter((a) => a.status === 'created' || a.status === 'updated')).toEqual([]);
  });

  it('conserva un .gitignore existente y anade el bloque', async () => {
    await writeFile(path.join(root, '.gitignore'), 'mio/\n');
    const actions = await runInit({ root, home });
    expect(status(actions)['.gitignore']).toBe('updated');
    const gi = await leer('.gitignore');
    expect(gi.startsWith('mio/\n')).toBe(true);
    expect(gi).toContain('node_modules/');
  });

  it('inyecta las reglas para agentes en el fichero de instrucciones existente', async () => {
    await writeFile(path.join(root, 'CLAUDE.md'), '# Proyecto\n');
    const actions = await runInit({ root, home });
    expect(status(actions)['CLAUDE.md']).toBe('updated');
    const md = await leer('CLAUDE.md');
    expect(md.startsWith('# Proyecto\n')).toBe(true);
    expect(md).toContain('<!-- >>> hygiene -->');
    expect(md).toContain('hygiene approve');
  });

  it('no crea un fichero de instrucciones si no hay ninguno', async () => {
    const actions = await runInit({ root, home });
    expect(actions.find((a) => a.file === 'CLAUDE.md')).toMatchObject({ status: 'skipped' });
  });

  it('cada edicion se puede deshacer con restore', async () => {
    await writeFile(path.join(root, '.gitignore'), 'mio/\n');
    const actions = await runInit({ root, home });
    const entry = actions.find((a) => a.file === '.gitignore')?.entry;
    expect(entry).toBeDefined();
    const [e] = await findEntries(home, entry!);
    expect(await restoreEntry(e!)).toMatchObject({ status: 'restored' });
    expect(await leer('.gitignore')).toBe('mio/\n');
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/init/`
Expected: FAIL.

- [ ] **Step 3: Crear las plantillas**

`templates/gitignore/common.txt`:

```
.env
.env.*
!.env.example
.tmp/
*.log
.DS_Store
Thumbs.db
```

`templates/gitignore/node.txt`:

```
node_modules/
dist/
coverage/
.next/
```

`templates/gitignore/python.txt`:

```
__pycache__/
*.pyc
.venv/
venv/
.pytest_cache/
```

`templates/gitignore/rust.txt`:

```
target/
```

`templates/gitignore/go.txt`:

```
/bin/
```

`templates/gitignore/java.txt`:

```
target/
build/
.gradle/
*.class
```

`templates/gitignore/dotnet.txt`:

```
bin/
obj/
```

`templates/agents.md`:

```markdown
## Higiene del proyecto (project-hygiene)

- Ficheros temporales, planes y borradores van en `.tmp/`, nunca en la raiz.
- No crees copias versionadas a mano (`-final`, `-v2`, `-backup`): usa Git.
- No dejes scripts de un solo uso en la raiz del proyecto.
- Puedes ejecutar `hygiene scan`, `hygiene audit`, `hygiene plan` y `hygiene explain <RULE-ID>`.
- No ejecutes `hygiene approve`, `hygiene clean`, `hygiene loop` ni `hygiene restore`: aprobar y aplicar cambios es decision de una persona.
```

`templates/hygienerc.yml`:

```yaml
# Configuracion de project-hygiene. Todas las claves son opcionales.
planner:
  min_confidence: 0.8
loop:
  max_iterations: 10
  stop_if_no_improvement: true
  stop_on_regression: true
  require_approval_for_risk: [medium, high, unknown]
```

En `package.json`, cambiar `"files": ["dist", "rules"]` por
`"files": ["dist", "rules", "templates"]`.

- [ ] **Step 4: Implementar `src/init/blocks.ts`**

```ts
/**
 * Sustituye el bloque entre marcadores, o lo anade al final. Idempotente:
 * aplicarlo dos veces con el mismo cuerpo da el mismo texto.
 */
export function replaceBlock(current: string | null, start: string, end: string, body: string): string {
  const block = `${start}\n${body.trimEnd()}\n${end}\n`;
  const text = current ?? '';
  const i = text.indexOf(start);
  const j = i === -1 ? -1 : text.indexOf(end, i + start.length);
  if (i !== -1 && j !== -1) {
    return text.slice(0, i) + block + text.slice(j + end.length).replace(/^\r?\n/, '');
  }
  if (text === '') return block;
  return `${text}${text.endsWith('\n') ? '' : '\n'}\n${block}`;
}
```

- [ ] **Step 5: Implementar `src/init/templates.ts`**

```ts
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/init -> ../../templates; dist/init -> ../../templates.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(HERE, '..', '..', 'templates');

export function readTemplate(rel: string): Promise<string> {
  return readFile(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
}

const MARKERS: Array<[string, RegExp]> = [
  ['node', /^package\.json$/],
  ['python', /^(pyproject\.toml|requirements\.txt|setup\.py)$/],
  ['rust', /^Cargo\.toml$/],
  ['go', /^go\.mod$/],
  ['java', /^(pom\.xml|build\.gradle(\.kts)?)$/],
  ['dotnet', /\.(csproj|sln)$/],
];

/** Tecnologias detectadas por los manifiestos de la raiz del proyecto. */
export async function detectTech(root: string): Promise<string[]> {
  const names = await readdir(root);
  return MARKERS.filter(([, re]) => names.some((n) => re.test(n))).map(([tech]) => tech);
}
```

- [ ] **Step 6: Implementar `src/init/run.ts`**

```ts
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { applyEdit, type EditOutcome } from '../executor/edit.js';
import { replaceBlock } from './blocks.js';
import { detectTech, readTemplate } from './templates.js';

export interface InitOptions {
  root: string;
  home: string;
  ci?: boolean;
  now?: Date;
}

export interface InitAction {
  file: string;
  status: 'created' | 'updated' | 'unchanged' | 'skipped';
  reason?: string;
  entry?: string;
}

const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md'];

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

function toAction(file: string, o: EditOutcome): InitAction {
  if (o.status === 'applied') return { file, status: o.created ? 'created' : 'updated', entry: o.entry };
  if (o.status === 'unchanged') return { file, status: 'unchanged' };
  return { file, status: 'skipped', reason: o.reason };
}

/**
 * Modo prevencion (spec §12). Idempotente y sin pisar nada ajeno; cada
 * escritura queda en el journal como INIT-NNNNNN y se deshace con restore.
 */
export async function runInit(o: InitOptions): Promise<InitAction[]> {
  const actions: InitAction[] = [];
  let n = 0;
  const edit = async (file: string, transform: (cur: string | null) => string, mode?: number) => {
    n += 1;
    const outcome = await applyEdit({
      root: o.root, home: o.home, opId: `INIT-${String(n).padStart(6, '0')}`, file,
      transform, mode, ruleIds: [], reason: 'hygiene init', now: o.now,
    });
    actions.push(toAction(file, outcome));
  };

  // 1. .gitignore segun las tecnologias detectadas.
  const techs = await detectTech(o.root);
  const parts = await Promise.all(['common', ...techs].map((t) => readTemplate(`gitignore/${t}.txt`)));
  const body = [...new Set(parts.join('\n').split(/\r?\n/).filter(Boolean))].join('\n');
  await edit('.gitignore', (cur) => replaceBlock(cur, '# >>> hygiene', '# <<< hygiene', body));

  // 2. .tmp/ como vertedero legitimo (ya ignorado por el bloque anterior).
  const tmp = path.join(o.root, '.tmp');
  if (await isDir(tmp)) {
    actions.push({ file: '.tmp/', status: 'unchanged' });
  } else {
    await mkdir(tmp);
    actions.push({ file: '.tmp/', status: 'created' });
  }

  // 3. .hygienerc.yml si no existe.
  const rc = await readTemplate('hygienerc.yml');
  await edit('.hygienerc.yml', (cur) => cur ?? rc);

  // 4. Reglas para agentes en el fichero de instrucciones existente, sin crear uno.
  const agents = await readTemplate('agents.md');
  let agentFile: string | null = null;
  for (const f of AGENT_FILES) {
    if (await isFile(path.join(o.root, f))) {
      agentFile = f;
      break;
    }
  }
  if (agentFile) {
    await edit(agentFile, (cur) => replaceBlock(cur, '<!-- >>> hygiene -->', '<!-- <<< hygiene -->', agents));
  } else {
    actions.push({ file: 'CLAUDE.md', status: 'skipped', reason: 'no hay fichero de instrucciones de agente; no se crea uno nuevo' });
  }

  return actions;
}
```

- [ ] **Step 7: Comando `init` en `src/cli/index.ts`**

Añadir la importación `import { runInit } from '../init/run.js';`, la opción
`ci: { type: 'boolean' },` en `parseArgs`, la línea de `USAGE`
`  init [ruta]            Modo prevencion: .gitignore, .tmp/, rc, reglas para agentes (--ci: workflow)`
tras la de `restore`, y este bloque tras el de `restore`:

```ts
    if (command === 'init') {
      const root = await resolveDir(target, print);
      if (!root) return 2;
      const actions = await runInit({ root, home: resolveHome(), ci: parsed.values.ci === true });
      for (const a of actions) {
        const extra = a.reason ? `  (${a.reason})` : a.entry ? `  -> ${a.entry}` : '';
        print(`  ${a.status.padEnd(9)} ${a.file}${extra}`);
      }
      print('Para deshacer un cambio: hygiene restore <AAAA-MM-DD/INIT-NNNNNN>');
      return 0;
    }
```

- [ ] **Step 8: Ejecutar toda la suite**

Run: `npm run typecheck && npm test && npm run build && npm run dogfood`
Expected: todo en verde.

- [ ] **Step 9: Commitear**

```bash
git add templates src/init src/cli/index.ts package.json tests/init
git commit -m "feat: hygiene init con .gitignore por tecnologia, .tmp, rc y reglas para agentes"
```

---

## Task 15: Hook de pre-commit y workflow de CI en `init`

**Files:**
- Create: `templates/pre-commit.sh`, `templates/ci-hygiene.yml`
- Modify: `src/init/run.ts`
- Test: `tests/init/run.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `tests/init/run.test.ts` (importar también `execFile` y `promisify`):

```ts
describe('runInit, hook y CI', () => {
  it('fuera de un repo git no instala el hook', async () => {
    const actions = await runInit({ root, home });
    expect(actions.find((a) => a.file === '.git/hooks/pre-commit')).toMatchObject({ status: 'skipped' });
  });

  it('instala el hook en un repo git', async () => {
    await promisify(execFile)('git', ['init', '-q'], { cwd: root });
    const actions = await runInit({ root, home });
    expect(status(actions)['.git/hooks/pre-commit']).toBe('created');
    const hook = await leer('.git/hooks/pre-commit');
    expect(hook.startsWith('#!/bin/sh')).toBe(true);
    expect(hook).toContain('--fail-on high');
    if (process.platform !== 'win32') {
      expect((await stat(path.join(root, '.git', 'hooks', 'pre-commit'))).mode & 0o111).not.toBe(0);
    }
  });

  it('no toca un hook pre-commit ajeno', async () => {
    await promisify(execFile)('git', ['init', '-q'], { cwd: root });
    await writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho mio\n');
    const actions = await runInit({ root, home });
    expect(actions.find((a) => a.file === '.git/hooks/pre-commit')).toMatchObject({ status: 'skipped' });
    expect(await leer('.git/hooks/pre-commit')).toBe('#!/bin/sh\necho mio\n');
  });

  it('--ci crea el workflow si no existe', async () => {
    const actions = await runInit({ root, home, ci: true });
    expect(status(actions)['.github/workflows/hygiene.yml']).toBe('created');
    expect(await leer('.github/workflows/hygiene.yml')).toContain('audit');
  });
});
```

Run: `npx vitest run tests/init/run.test.ts`
Expected: FAIL.

- [ ] **Step 2: Plantillas**

`templates/pre-commit.sh` (solo el cuerpo del bloque; el shebang lo pone `init`):

```sh
# Bloquea el commit si hygiene detecta un secreto expuesto (severidad high o mayor).
if command -v hygiene >/dev/null 2>&1; then
  hygiene audit . --axis security --fail-on high || exit 1
elif command -v npx >/dev/null 2>&1 && npx --no-install hygiene --help >/dev/null 2>&1; then
  npx --no-install hygiene audit . --axis security --fail-on high || exit 1
else
  echo "hygiene no esta instalado: no se ha comprobado si hay secretos." >&2
fi
```

`templates/ci-hygiene.yml`:

```yaml
name: hygiene
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes project-hygiene audit . --json
```

- [ ] **Step 3: Pasos 5 y 6 de `runInit`**

En `src/init/run.ts`, añadir antes de `return actions;`:

```ts
  // 5. Hook de pre-commit, solo en un repo y sin pisar uno ajeno.
  const hookFile = '.git/hooks/pre-commit';
  if (!(await isDir(path.join(o.root, '.git')))) {
    actions.push({ file: hookFile, status: 'skipped', reason: 'no es un repositorio git' });
  } else {
    const hookBody = await readTemplate('pre-commit.sh');
    const hookAbs = path.join(o.root, '.git', 'hooks', 'pre-commit');
    const foreign = (await isFile(hookAbs)) && !(await readTextOrNull(hookAbs))?.includes('# >>> hygiene');
    if (foreign) {
      actions.push({ file: hookFile, status: 'skipped', reason: 'ya existe un hook pre-commit ajeno; no se toca' });
    } else {
      await edit(hookFile, (cur) => replaceBlock(cur ?? '#!/bin/sh\n', '# >>> hygiene', '# <<< hygiene', hookBody), 0o755);
    }
  }

  // 6. Workflow de CI opcional.
  if (o.ci) {
    const ci = await readTemplate('ci-hygiene.yml');
    await edit('.github/workflows/hygiene.yml', (cur) => cur ?? ci);
  }
```

y cambiar la importación de `../executor/edit.js` por
`import { applyEdit, readTextOrNull, type EditOutcome } from '../executor/edit.js';`.

- [ ] **Step 4: Ejecutar toda la suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commitear**

```bash
git add templates/pre-commit.sh templates/ci-hygiene.yml src/init/run.ts tests/init/run.test.ts
git commit -m "feat: init instala el hook de secretos y, con --ci, el workflow de auditoria"
```

---

## Task 16: `hygiene loop`

**Files:**
- Create: `src/loop.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/loop.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runLoop } from '../src/loop.js';
import { DEFAULT_LOOP, type HygieneConfig } from '../src/config/load.js';

const RULES = path.join(process.cwd(), 'rules');
const existe = (p: string) => access(p).then(() => true, () => false);
let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-loop-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function logViejo(rel: string, contenido: string): Promise<void> {
  const p = path.join(root, rel);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}
const config = (extra: Partial<HygieneConfig['loop']> = {}): HygieneConfig => ({ limits: {}, loop: { ...DEFAULT_LOOP, ...extra } });

describe('runLoop', () => {
  it('ejecuta por politica lo seguro, reaudita y para cuando no queda nada', async () => {
    await logViejo('a.log', 'a');
    await logViejo('b.log', 'b');
    const r = await runLoop({ root, rulesDir: RULES, home, config: config() });
    expect(r.iterations).toHaveLength(1);
    expect(r.iterations[0]).toMatchObject({ n: 1, executed: 2 });
    expect(r.scoreFinal).toBeGreaterThan(r.scoreInitial);
    expect(r.stop).toBe('no-operations');
    expect(await existe(path.join(root, 'a.log'))).toBe(false);
  });

  it('si la politica exige aprobacion para todo, no mueve nada', async () => {
    await logViejo('a.log', 'a');
    const r = await runLoop({
      root, rulesDir: RULES, home,
      config: config({ requireApprovalForRisk: ['safe', 'low', 'medium', 'high', 'unknown'] }),
    });
    expect(r).toMatchObject({ iterations: [], stop: 'no-operations' });
    expect(await existe(path.join(root, 'a.log'))).toBe(true);
  });

  it('respeta max_iterations', async () => {
    await logViejo('a.log', 'a');
    const r = await runLoop({ root, rulesDir: RULES, home, config: config({ maxIterations: 1, stopIfNoImprovement: false }) });
    expect(r.iterations.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/loop.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/loop.ts`**

```ts
import type { HygieneConfig } from './config/load.js';
import { runPlan, type PlanRun } from './plan.js';
import { runClean } from './clean.js';
import { EXECUTABLE_TYPES } from './planner/plan.js';
import { loadApprovals, saveApprovals } from './approvals/store.js';
import { mergeApproval } from './approvals/approve.js';

export interface LoopOptions {
  root: string;
  rulesDir: string;
  home: string;
  config: HygieneConfig;
  now?: () => Date;
}

export type LoopStop = 'no-operations' | 'no-improvement' | 'regression' | 'max-iterations' | 'stale' | 'failed';

export interface LoopIteration {
  n: number;
  scoreBefore: number;
  scoreAfter: number;
  executed: number;
}

export interface LoopResult {
  iterations: LoopIteration[];
  stop: LoopStop;
  scoreInitial: number;
  scoreFinal: number;
}

/**
 * AUDIT -> SCORE -> PLAN -> APPROVAL POLICY -> EXECUTE -> VALIDATE -> COMPARE
 * (spec §11). La politica se materializa como aprobaciones concretas en
 * ~/.hygiene/approvals/ (decision 12). Nunca persigue el 100 por si mismo.
 */
export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const now = o.now ?? (() => new Date());
  const planOptions = {
    root: o.root,
    rulesDir: o.rulesDir,
    limits: o.config.limits,
    minConfidence: o.config.minConfidence,
    defaultBranch: o.config.defaultBranch,
  };
  const requires = new Set(o.config.loop.requireApprovalForRisk);
  const iterations: LoopIteration[] = [];

  let current: PlanRun = await runPlan(planOptions);
  const scoreInitial = current.audit.score.total;
  const done = (stop: LoopStop): LoopResult => ({
    iterations, stop, scoreInitial, scoreFinal: current.audit.score.total,
  });

  for (let n = 1; n <= o.config.loop.maxIterations; n++) {
    const auto = current.plan.operations.filter((op) =>
      EXECUTABLE_TYPES.has(op.type) && op.risk !== 'unknown' && !requires.has(op.risk));
    if (auto.length === 0) return done('no-operations');

    const record = mergeApproval(
      await loadApprovals(o.home, o.root),
      current.plan,
      auto,
      ['loop', `politica: requieren aprobacion ${[...requires].join(', ')}`],
      now(),
    );
    await saveApprovals(o.home, record);

    const clean = await runClean({ ...planOptions, home: o.home, now: now() });
    if (clean.status === 'stale') return done('stale');
    if (clean.status === 'no-approvals') return done('no-operations');

    const executed = clean.outcomes.filter((x) => x.status === 'quarantined' || x.status === 'applied').length;
    const next = await runPlan(planOptions);
    const before = current.audit.score.total;
    const after = next.audit.score.total;
    iterations.push({ n, scoreBefore: before, scoreAfter: after, executed });
    current = next;

    if (clean.outcomes.some((x) => x.status === 'failed')) return done('failed');
    if (after < before && o.config.loop.stopOnRegression) return done('regression');
    if (after <= before && o.config.loop.stopIfNoImprovement) return done('no-improvement');
  }
  return done('max-iterations');
}
```

- [ ] **Step 4: Comando `loop` en `src/cli/index.ts`**

Añadir la importación `import { runLoop } from '../loop.js';`, la línea de
`USAGE`
`  loop [--root <ruta>]   Ciclo acotado: aprueba por politica, limpia y reaudita`
y este bloque tras el de `init`:

```ts
    if (command === 'loop') {
      const root = await resolveDir(parsed.values.root, print);
      if (!root) return 2;
      const r = await runLoop({ root, rulesDir: RULES_DIR, home: resolveHome(), config: await loadConfig(root) });
      for (const it of r.iterations) {
        print(`  iteracion ${it.n}  ${it.scoreBefore} -> ${it.scoreAfter}  ejecutadas ${it.executed}`);
      }
      print(`Puntuacion ${r.scoreInitial} -> ${r.scoreFinal}. Parada: ${r.stop}.`);
      print('Para deshacer: hygiene restore <OP-ID>');
      return r.stop === 'failed' || r.stop === 'stale' ? 2 : 0;
    }
```

- [ ] **Step 5: Ejecutar toda la suite**

Run: `npm run typecheck && npm test && npm run build && npm run dogfood`
Expected: todo en verde.

- [ ] **Step 6: Commitear**

```bash
git add src/loop.ts src/cli/index.ts tests/loop.test.ts
git commit -m "feat: hygiene loop con aprobacion por politica registrada y paradas acotadas"
```

---

## Task 17: Fixture `examples/after/`

**Files:**
- Create: `examples/after/README.md`, `examples/after/proyecto-a/{README.md,package.json,.gitignore,config/settings.json,src/index.ts,tests/index.test.ts}`
- Modify: `tests/golden/golden.test.ts`

- [ ] **Step 1: Crear el fixture desde `examples/before`**

```bash
mkdir -p examples/after/proyecto-a/config examples/after/proyecto-a/src examples/after/proyecto-a/tests
cp examples/before/README.md examples/after/README.md
cp examples/before/proyecto-a/README.md examples/before/proyecto-a/package.json examples/after/proyecto-a/
cp examples/before/proyecto-a/config/settings.json examples/after/proyecto-a/config/
cp examples/before/proyecto-a/src/index.ts examples/after/proyecto-a/src/
cp examples/before/proyecto-a/tests/index.test.ts examples/after/proyecto-a/tests/
printf 'node_modules/\n' > examples/after/proyecto-a/.gitignore
```

El estado `after` es el de `before` sin los restos que las reglas señalan:
`debug.log`, `deploy.sh`, `notas-final.md`, `resumen.md`,
`settings-backup.json` y `server.crt`. Además, `proyecto-a` tiene
`.gitignore`, y el test lo convierte en repositorio.

- [ ] **Step 2: Escribir el test**

En `tests/golden/golden.test.ts`, añadir las importaciones de `execFile` y
`promisify` y este bloque al final:

```ts
describe('fixture dorado after', () => {
  let after: string;
  beforeAll(async () => {
    after = await mkdtemp(path.join(tmpdir(), 'hyg-golden-after-'));
    await cp(path.join(process.cwd(), 'examples', 'after'), after, { recursive: true });
    const ahora = new Date();
    for (const rel of await readdir(after, { recursive: true })) {
      await utimes(path.join(after, rel), ahora, ahora);
    }
    // Un repo no se puede versionar dentro de otro: se crea en la copia.
    await promisify(execFile)('git', ['init', '-q'], { cwd: path.join(after, 'proyecto-a') });
  });
  afterAll(async () => { await rm(after, { recursive: true, force: true }); });

  it('el estado objetivo audita limpio y sin hallazgos', async () => {
    const result = await runAudit({ root: after, rulesDir: path.join(process.cwd(), 'rules') });
    expect(result.findings.map((f) => `${f.ruleId} ${f.path}`)).toEqual([]);
    expect(result.score.clean).toBe(true);
  });
});
```

- [ ] **Step 3: Ejecutarlo**

Run: `npx vitest run tests/golden`
Expected: PASS. Si aparece algún hallazgo, no se cambia la expectativa: o el
fixture todavía tiene un resto real, o una regla dispara de más y hay que
corregirla con su test.

- [ ] **Step 4: Commitear**

```bash
git add examples/after tests/golden/golden.test.ts
git commit -m "test: fixture dorado after que audita limpio"
```

---

## Task 18: Prueba de empaquetado, README y verificación final

**Files:**
- Create: `scripts/pack-smoke.mjs`
- Modify: `package.json`, `.github/workflows/ci.yml`, `README.md`

- [ ] **Step 1: Implementar `scripts/pack-smoke.mjs`**

```js
// Prueba de empaquetado: npm pack, instalacion limpia y uso real del binario.
// Comprueba que dist, rules y templates viajan en el paquete (spec §18).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const win = process.platform === 'win32';
const npm = (args, cwd) => execFileSync(win ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', shell: win });

const work = mkdtempSync(path.join(tmpdir(), 'hyg-pack-'));
const home = mkdtempSync(path.join(tmpdir(), 'hyg-pack-home-'));
try {
  const [{ filename }] = JSON.parse(npm(['pack', '--json', '--pack-destination', work], process.cwd()));
  const app = path.join(work, 'app');
  mkdirSync(app);
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'smoke', version: '1.0.0', private: true }));
  npm(['install', '--no-audit', '--no-fund', path.join(work, filename)], app);

  if (!existsSync(path.join(app, 'node_modules', '.bin', win ? 'hygiene.cmd' : 'hygiene'))) {
    throw new Error('el paquete no instala el binario hygiene');
  }
  const bin = path.join(app, 'node_modules', 'project-hygiene', 'dist', 'cli', 'index.js');
  const hygiene = (args) => execFileSync(process.execPath, [bin, ...args], {
    cwd: app, encoding: 'utf8', env: { ...process.env, HYGIENE_HOME: home },
  });

  if (!hygiene(['--help']).includes('Comandos:')) throw new Error('--help no muestra el uso');
  if (!hygiene(['explain', 'FS-TEMP-001']).includes('FS-TEMP-001')) throw new Error('las reglas no viajan en el paquete');
  hygiene(['init', '.']);
  if (!readFileSync(path.join(app, '.gitignore'), 'utf8').includes('node_modules/')) {
    throw new Error('las plantillas no viajan en el paquete');
  }
  console.log('pack-smoke OK');
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
```

En `package.json`, añadir a `scripts`:
`"pack-smoke": "node scripts/pack-smoke.mjs"`.

En `.github/workflows/ci.yml`, añadir al final de `steps`:

```yaml
      # spec §18: el paquete se instala y funciona (dist, rules y templates).
      - run: npm run pack-smoke
```

- [ ] **Step 2: Ejecutar la prueba**

Run: `npm run build && npm run pack-smoke`
Expected: `pack-smoke OK`. `git status` no muestra ningún `.tgz`, porque el
tarball se genera en el directorio temporal.

- [ ] **Step 3: README**

En `README.md`:

1. En `## Uso`, añadir antes de `## Qué audita hoy`:

````markdown
### Prevención y ciclo

```bash
node dist/cli/index.js init .          # .gitignore, .tmp/, rc, reglas para agentes, hook
node dist/cli/index.js init . --ci     # además, workflow de auditoría
node dist/cli/index.js loop --root .   # aprueba por política, limpia y reaudita
node dist/cli/index.js audit . --axis security --fail-on high
```

`init` es idempotente y no pisa nada ajeno: los bloques gestionados van entre
marcadores y cada cambio se deshace con `hygiene restore <fecha>/INIT-NNNNNN`.
`loop` registra como aprobaciones concretas lo que su política aprueba
(`loop.require_approval_for_risk`, por defecto `medium`, `high` y `unknown`
exigen aprobación explícita) y para en cuanto la puntuación no mejora.

### Configuración

`.hygienerc.yml` en la raíz auditada, con precedencia sobre
`~/.config/hygiene/config.yml`. Claves: `engine` (límites del motor),
`planner.min_confidence`, `git.default_branch` y `loop`. Una clave
desconocida es un error, no un aviso.
````

2. Sustituir la sección `## Estado` hasta antes de `## Reglas disponibles` por:

```markdown
## Estado

v1 completa en tres entregas: núcleo de solo lectura; planner, aprobación y
cuarentena reversible; y ejes completos con prevención (`init`) y ciclo
(`loop`). `clean` ejecuta cuarentenas e `ignore`; `create` solo lo hace
`init`.

Pendiente fuera de la v1: publicación en npm, `.hygienerc.yml` por
subproyecto, detección de instrucciones de agente en conflicto, y los packs y
salidas de la v2 (dependencias, documentación, tests, CI, HTML, SARIF).
```

- [ ] **Step 4: Verificación completa**

Run: `npm run typecheck && npm test && npm run build && npm run dogfood && npm run pack-smoke`
Expected: todo en verde. Después, `node dist/cli/index.js plan examples/before`
seguido de `git status --short` debe dejar el árbol limpio.

- [ ] **Step 5: Commitear**

```bash
git add scripts/pack-smoke.mjs package.json .github/workflows/ci.yml README.md
git commit -m "chore: prueba de empaquetado en CI y README de la v1 completa"
```

**Fin de la parte B.** Aquí se abre el segundo PR.

---

## Autorrevisión del plan

**Cobertura de la especificación.**

| Requisito | Tareas |
|---|---|
| §2 frontera desconocida reportada, workspace con varios proyectos | 4, 7 (`FS-BOUNDARY-001`, Git por proyecto) |
| §4 vocabulario cerrado, `in_git_history`, schema estricto | 5, 6 |
| §5 límites: `max_git_history_commits` visible como `RULE_EXECUTION_LIMIT` | 1, 3, 6, 8 |
| §7 las 16 reglas pendientes de los cuatro ejes | 7, 8 |
| §7 `GIT-BRANCH-001` stale/orphaned con resolución de rama por defecto | 3, 5, 8 |
| §7 `SEC-HIST-001` sin reescribir historia; `SEC-PERM-001` con `unsupported` | 5, 6, 8 |
| §8 reversibilidad también de las ediciones | 10, 12, 14 |
| §11 loop acotado, sin perseguir el 100 | 16 |
| §12 init idempotente, sin sobrescribir sin copia, sin crear instrucciones nuevas | 14, 15 |
| §13 reglas para agentes inyectadas; `--json` estable | 14 |
| §14 precedencia de configuración | 1, 2 |
| §15 fixtures dorados before y after | 9, 17 |
| §18 se instala y funciona empaquetado; CI en los tres sistemas | 18 |

**Búsqueda de marcadores.** Ningún paso contiene TBD ni "similar a la tarea
N". La tarea 6 pide un test para `human.test.ts` describiendo su contenido
exacto (campo y cadenas esperadas), porque el helper de ese fichero no se
reproduce aquí.

**Consistencia de tipos.**
- `HygieneConfig`, `LoopConfig` y `DEFAULT_LOOP` se definen en la tarea 1 y
  los usan las tareas 2 y 16.
- `GitOptions` (tarea 3) lo consume `collectGitByProject` (tarea 4).
- `WorkspaceFacts` (tarea 4) lo usan los predicados (tarea 5).
- `gitKeyFor` (tarea 4) lo reutiliza `runPlan` (tarea 11).
- `RuleLimitError` y `UnsupportedPredicateError` (tarea 5) los captura el
  evaluador (tarea 6).
- `UnsupportedHit` (tarea 6) va en `AuditResult` y en el informe.
- `fingerprintText`, `readTextOrNull`, `writeTextAtomic`, `applyEdit` y
  `EditOutcome` (tarea 10) los usan `restore` (10), `runPlan` (11),
  `ignoreOne` y `clean` (12) e `init` (14, 15).
- `IgnoreTarget` (tarea 11) lo produce `runPlan` y lo consume el planner.
- `ExecOutcome` (tarea 12) es el tipo de las salidas de `clean` que lee
  `loop` (tarea 16).

**Riesgos conocidos al ejecutar.**

- La tarea 3 depende de que `git log -z --name-only --format=` separe las
  rutas por NUL en las tres plataformas de CI. Si no, el test de historial
  falla en esa plataforma y se ajusta el parseo, no el test.
- El snapshot de la tarea 9 tiene una lista esperada explícita. Una regla que
  dispare de más sobre `examples/before` se corrige; no se acepta en el
  snapshot.
- Las tareas 7 y 8 crean repos y ramas reales en directorios temporales.
  Necesitan `git` en el PATH, que ya es requisito del plan 1.
