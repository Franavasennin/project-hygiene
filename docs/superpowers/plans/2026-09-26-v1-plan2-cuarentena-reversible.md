# project-hygiene v1, plan 2 de 3: planner, aprobación, executor y cuarentena reversible

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `hygiene plan`, `hygiene approve`, `hygiene clean --approved` y
`hygiene restore` funcionen de extremo a extremo: los hallazgos se convierten
en operaciones con ID, el usuario aprueba operaciones concretas, el executor
mueve solo lo aprobado a una cuarentena fuera del workspace y todo se puede
devolver verificando el hash.

**Architecture:** cuatro capas separadas por la frontera de aprobación (NN-3).
El planner es una función pura que convierte `Finding[]` en `Operation[]`
aplicando las degradaciones de la §6 de la spec. La aprobación materializa IDs
concretos en `~/.hygiene/approvals/`. El executor revalida cada origen contra el
disco, escribe el manifiesto y mueve a `~/.hygiene/quarantine/`. `restore` hace
el camino inverso y nunca sobrescribe ni devuelve un payload cuyo hash no
coincide.

**Tech Stack:** el mismo del plan 1. TypeScript 5 estricto sobre Node 20+, ESM,
Vitest. No se añade ninguna dependencia: hash con `node:crypto`, ACL de Windows
con `icacls` vía `execFile` (sin shell).

**Referencia:** `docs/superpowers/specs/2026-09-09-project-hygiene-design.md`,
secciones 3, 6, 8, 9 y 15. Plan anterior:
`docs/superpowers/plans/2026-09-09-v1-nucleo-read-only.md`.

---

## Decisiones de diseño de este plan

Estas decisiones concretan lo que la spec deja abierto. Cada una se toma en la
dirección más conservadora. Revisarlas antes de ejecutar: cambiar una después
obliga a rehacer tareas.

1. **Solo `quarantine` es ejecutable en esta entrega.** El planner produce
   también `ignore`, `move` y `create`, pero `approve` las rechaza. Escribir en
   `.gitignore` o crear ficheros es trabajo de `init` (plan 3), que ya tiene que
   saber hacerlo de forma idempotente y con copia previa. `review` es
   informativa por definición y no se aprueba nunca.
2. **Solo van a cuarentena ficheros regulares con huella.** Directorios,
   symlinks, entradas generadas no recorridas y ficheros sin sha256 (porque
   superan `max_file_size_for_content_scan` o no se pudieron leer) se degradan a
   `review`. Sin hash no hay `restore` verificable (§8).
3. **La identidad de una aprobación es tipo + ruta + sha256, no el OP-ID.**
   Los OP-ID solo son estables mientras no cambia el disco: un hallazgo nuevo
   desplaza la numeración. El OP-ID se guarda como dato informativo.
4. **La caducidad es todo o nada.** `clean` recalcula el plan. Si una sola
   operación aprobada ya no aparece con el mismo tipo, ruta y hash, no se mueve
   nada y se listan las caducadas. Así se cumple "una aprobación caduca si el
   plan que la originó ya no coincide con el estado del disco" (§9).
5. **Cada aprobación vale para una sola ejecución.** `clean` borra el fichero
   de aprobaciones después de intentar todas las operaciones. `approve --reset`
   descarta aprobaciones pendientes caducadas.
6. **El manifiesto se escribe antes de mover** (estado `pending`), no después
   como sugiere el diagrama de la §8. Si el proceso muere a mitad, la entrada
   existe y `restore` sabe dónde mirar. Refuerza el principio 3 sin cambiar el
   formato del manifiesto, al que solo se añaden campos.
7. **La base de hygiene se configura con `HYGIENE_HOME`.** El cargador de
   `.hygienerc.yml` todavía no existe (plan 3). Se comprueba en la capa más baja
   de escritura (`saveApprovals` y `quarantineOne`) que la base no cae dentro
   del workspace auditado ni al revés.
8. **Umbral de confianza por defecto: 0.8.** Con los packs actuales solo
   `FS-TEMP-001` (confianza 0.9, riesgo `safe`) llega a proponer cuarentena.
9. **Referencias indeterminadas bloquean la cuarentena.** Si la búsqueda de
   referencias agota su tope, salta un fichero fuente por tamaño o por error de
   lectura, o el inventario está truncado, ningún fichero va a cuarentena (§6:
   "si `referenced_by_source` no se pudo determinar"). En repos con un
   `package-lock.json` de más de 2 MB esto bloquea toda cuarentena. Es un
   límite conocido y aceptado: se resolverá con búsqueda en streaming, no
   relajando la regla.
10. **OP-ID repetidos entre ejecuciones.** La entrada de cuarentena es
    `AAAA-MM-DD/OP-000123`. Si ya existe, se crea `OP-000123-2`. `restore
    OP-000123` con varias entradas activas se niega y pide la referencia exacta
    `AAAA-MM-DD/OP-000123-2`.
11. **El evaluador de ámbito de proyecto pasa al plan 3.** El plan 1 anotó que
    entraba aquí junto con las 15 reglas que lo necesitan (`FS-ROOT-001`,
    `GIT-NOREPO-001`, `AI-DOC-001`…). Se mueve al plan 3 para que este plan
    cubra solo la mitad que modifica el disco, que es lo que tiene riesgo real.
    Ninguna de esas reglas propone `quarantine`, así que el executor no depende
    de ellas.
12. **Límite conocido: un agente puede ejecutar `approve`.** La spec (§13)
    prohíbe que el agente cruce la frontera, pero la CLI no puede distinguir a
    una persona de un agente. La mitigación de esta entrega es documental; la
    decisión de exigir TTY o confirmación interactiva queda abierta para el
    plan 3.

**Corrección incluida.** Durante la redacción se detectó que `findReferences`
en `src/audit.ts` hace `readFile` sobre entradas symlink, lo que se salta el
tope de tamaño igual que el bug que el plan 1 cerró en `collectors/content.ts`.
La tarea 3 lo corrige con test de regresión.

**Fuera de este plan:** `init`, `loop`, ejecución de `ignore`/`move`/`create`,
el evaluador de ámbito de proyecto y sus 15 reglas, `in_git_history` y
`SEC-HIST-001`, `examples/after/`, los informes en `~/.hygiene/reports/` y el
cargador de `.hygienerc.yml`. Van al plan 3.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/core/types.ts` (modificar) | Añade `Operation`, `Plan`, `OperationType`, `DegradeReason`. Sin lógica. |
| `src/core/home.ts` | Resuelve la base de hygiene y garantiza que no se solapa con el workspace. |
| `src/audit.ts` (modificar) | Expone referencias, su completitud y la caché de contenido al planner. |
| `src/planner/plan.ts` | Planner puro: hallazgos → operaciones. Define qué tipos son ejecutables. |
| `src/plan.ts` | Orquestador read-only: auditoría + huellas + planner. |
| `src/report/plan.ts` | Salida de plan para persona. |
| `src/approvals/store.ts` | Lectura y escritura del fichero de aprobaciones de un workspace. |
| `src/approvals/approve.ts` | Selección por ID o `--risk` y fusión de aprobaciones. Puro. |
| `src/executor/hash.ts` | sha256 de un fichero en streaming. |
| `src/executor/move.ts` | Movimiento con `rename` y respaldo verificado entre volúmenes. |
| `src/executor/permissions.ts` | Captura y restauración de permisos según plataforma. |
| `src/executor/manifest.ts` | Formato del manifiesto, asignación de entradas y búsqueda. |
| `src/executor/quarantine.ts` | Revalida y pone en cuarentena una operación. |
| `src/executor/restore.ts` | Devuelve una entrada verificando hash y sin sobrescribir. |
| `src/clean.ts` | Orquestador de `clean`: aprobaciones → revalidación → executor. |
| `src/cli/index.ts` (modificar) | Comandos `plan`, `approve`, `clean`, `restore`. |

---

## Task 1: Tipos de operación y de plan

**Files:**
- Modify: `src/core/types.ts` (añadir al final)

- [ ] **Step 1: Añadir los tipos al final de `src/core/types.ts`**

```ts
export type OperationType = SuggestionType;

export type DegradeReason =
  | 'unknown-risk'
  | 'unknown-project-boundary'
  | 'low-confidence'
  | 'not-a-regular-file'
  | 'referenced-by-source'
  | 'references-undetermined'
  | 'hash-unavailable'
  | 'conflicting-suggestions';

export interface Operation {
  /** Estable dentro del plan: mismo estado de disco, mismo ID. */
  id: string;
  type: OperationType;
  path: string;
  findingIds: string[];
  ruleIds: string[];
  risk: Risk;
  reason: string;
  degradedFrom: OperationType | null;
  degradeReason: DegradeReason | null;
  /** Huella del origen al planificar; el executor la revalida antes de mover. */
  source: { sha256: string | null; size: number };
}

export interface Plan {
  planId: string;
  root: string;
  createdAt: string;
  engineVersion: string;
  minConfidence: number;
  operations: Operation[];
}
```

- [ ] **Step 2: Comprobar que compila**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commitear**

```bash
git add src/core/types.ts
git commit -m "feat: tipos Operation y Plan para el planner"
```

---

## Task 2: Base de hygiene fuera del workspace

**Files:**
- Create: `src/core/home.ts`
- Test: `tests/core/home.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { resolveHome, assertHomeOutside, HomeInsideWorkspaceError } from '../../src/core/home.js';

let base: string;
beforeEach(async () => { base = await mkdtemp(path.join(tmpdir(), 'hyg-home-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe('resolveHome', () => {
  it('usa HYGIENE_HOME cuando esta definida', () => {
    expect(resolveHome({ HYGIENE_HOME: path.join(base, 'h') })).toBe(path.join(base, 'h'));
  });

  it('cae en ~/.hygiene si no hay variable', () => {
    expect(resolveHome({})).toBe(path.join(homedir(), '.hygiene'));
  });

  it('ignora una variable vacia', () => {
    expect(resolveHome({ HYGIENE_HOME: '  ' })).toBe(path.join(homedir(), '.hygiene'));
  });
});

describe('assertHomeOutside', () => {
  it('acepta una base hermana del workspace', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(path.join(base, 'hyg'), ws)).resolves.toBeUndefined();
  });

  it('rechaza una base dentro del workspace aunque aun no exista', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(path.join(ws, '.hygiene'), ws))
      .rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('rechaza una base igual al workspace', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(ws, ws)).rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('rechaza un workspace dentro de la base', async () => {
    const hyg = path.join(base, 'hyg');
    const ws = path.join(hyg, 'ws');
    await mkdir(ws, { recursive: true });
    await expect(assertHomeOutside(hyg, ws)).rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('no confunde un prefijo de nombre con contencion', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(path.join(base, 'ws-hygiene'), ws)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `npx vitest run tests/core/home.test.ts`
Expected: FAIL, no se puede resolver `../../src/core/home.js`.

- [ ] **Step 3: Implementar `src/core/home.ts`**

```ts
import os from 'node:os';
import path from 'node:path';
import { realpath } from 'node:fs/promises';

export class HomeInsideWorkspaceError extends Error {}

/** Base de cuarentena y aprobaciones. Configurable con HYGIENE_HOME. */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const custom = env.HYGIENE_HOME;
  if (custom && custom.trim() !== '') return path.resolve(custom);
  return path.join(os.homedir(), '.hygiene');
}

/**
 * realpath del ancestro existente mas cercano, mas el resto sin resolver. La
 * base puede no existir todavia y aun asi hay que compararla con rutas reales
 * (en macOS, /var es un enlace a /private/var).
 */
async function realpathLoose(p: string): Promise<string> {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let current = abs;
  for (;;) {
    try {
      const real = await realpath(current);
      return path.join(real, ...[...rest].reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function contains(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * La cuarentena vive fuera del workspace (spec §8): si cayera dentro, la
 * herramienta crearia una carpeta que ella misma tendria que auditar.
 */
export async function assertHomeOutside(home: string, root: string): Promise<void> {
  const h = await realpathLoose(home);
  const r = await realpathLoose(root);
  if (contains(r, h)) {
    throw new HomeInsideWorkspaceError(
      `la base de hygiene (${h}) cae dentro del workspace auditado (${r}); define HYGIENE_HOME fuera de el`,
    );
  }
  if (contains(h, r)) {
    throw new HomeInsideWorkspaceError(
      `el workspace auditado (${r}) cae dentro de la base de hygiene (${h})`,
    );
  }
}
```

- [ ] **Step 4: Ejecutar el test y verlo pasar**

Run: `npx vitest run tests/core/home.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commitear**

```bash
git add src/core/home.ts tests/core/home.test.ts
git commit -m "feat: base de hygiene configurable y siempre fuera del workspace"
```

---

## Task 3: La auditoría expone referencias y su completitud

El planner necesita saber no solo qué está referenciado, sino si la búsqueda
pudo mirarlo todo. Hoy `findReferences` devuelve un `Set` y no distingue "nadie
lo referencia" de "no se pudo comprobar". Además sigue symlinks.

**Files:**
- Modify: `src/audit.ts`
- Test: `tests/audit.test.ts` (añadir al final)

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/audit.test.ts`, cambiar la importación de `node:fs/promises` a
`import { mkdtemp, writeFile, rm, utimes, symlink } from 'node:fs/promises';`,
la de `../src/audit.js` a
`import { runAudit, collectAudit } from '../src/audit.js';` y añadir al final:

```ts
describe('collectAudit', () => {
  it('expone las referencias y las marca completas en un arbol pequeno', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    await writeFile(path.join(root, 'README.md'), 'ver debug.log');
    const { facts } = await collectAudit({ root, rulesDir: RULES });
    expect(facts.referenced.has('debug.log')).toBe(true);
    expect(facts.referencesComplete).toBe(true);
  });

  it('marca las referencias incompletas si se agota el tope de busqueda', async () => {
    await writeFile(path.join(root, 'a.md'), 'a');
    await writeFile(path.join(root, 'b.md'), 'b');
    const { facts } = await collectAudit({
      root, rulesDir: RULES, limits: { maxReferenceSearchFiles: 1 },
    });
    expect(facts.referencesComplete).toBe(false);
  });

  it('marca las referencias incompletas si un fichero fuente supera el tope de tamano', async () => {
    await writeFile(path.join(root, 'grande.md'), 'x'.repeat(64));
    const { facts } = await collectAudit({
      root, rulesDir: RULES, limits: { maxFileSizeForContentScan: 16 },
    });
    expect(facts.referencesComplete).toBe(false);
  });

  it.runIf(process.platform !== 'win32')('no sigue symlinks al buscar referencias', async () => {
    const fuera = await mkdtemp(path.join(tmpdir(), 'hyg-fuera-'));
    try {
      await writeFile(path.join(fuera, 'grande.md'), 'debug.log '.repeat(1000));
      await writeFile(path.join(root, 'debug.log'), 'x');
      await symlink(path.join(fuera, 'grande.md'), path.join(root, 'enlace.md'));
      const { facts } = await collectAudit({ root, rulesDir: RULES });
      expect(facts.referenced.has('debug.log')).toBe(false);
      expect(facts.referencesComplete).toBe(true);
    } finally {
      await rm(fuera, { recursive: true, force: true });
    }
  });

  it('runAudit devuelve exactamente el result de collectAudit', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    const directo = await runAudit({ root, rulesDir: RULES });
    const { result } = await collectAudit({ root, rulesDir: RULES });
    expect(result.findings).toEqual(directo.findings);
    expect(result.score).toEqual(directo.score);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/audit.test.ts`
Expected: FAIL, `collectAudit` no está exportado.

- [ ] **Step 3: Sustituir `findReferences` en `src/audit.ts`**

Reemplazar la función `findReferences` entera por:

```ts
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
    if (scanned >= budget.limits.maxReferenceSearchFiles) {
      budget.note('maxReferenceSearchFiles');
      complete = false;
      break;
    }
    if (!SOURCE_EXT.has(path.extname(f.path))) continue;
    // Un symlink no se sigue: readFile leeria el destino, que puede estar
    // fuera del arbol y saltarse el tope de tamano (mismo criterio que
    // collectors/content.ts). Si el destino esta dentro del arbol, se examina
    // por su propia entrada.
    if (f.isSymlink) continue;
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
```

- [ ] **Step 4: Convertir `runAudit` en `collectAudit` y dejar `runAudit` como envoltorio**

En `src/audit.ts`, justo después de la interfaz `AuditOptions`, añadir:

```ts
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
```

Después, tres cambios dentro de la función actual `runAudit`:

1. Cambiar la firma
   `export async function runAudit(options: AuditOptions): Promise<AuditResult> {`
   por `export async function collectAudit(options: AuditOptions): Promise<CollectedAudit> {`.
2. Cambiar `const referenced = await findReferences(files, budget);` por
   `const refs = await findReferences(files, budget);` y, dentro de
   `makeContext`, `referencedPaths: referenced,` por
   `referencedPaths: refs.referenced,`.
3. Sustituir la última línea `return { inventory, findings, limits, score };`
   y la llave de cierre por:

```ts
  return {
    result: { inventory, findings, limits, score },
    facts: {
      referenced: refs.referenced,
      referencesComplete: refs.complete && !truncated,
      content,
    },
  };
}

export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  return (await collectAudit(options)).result;
}
```

- [ ] **Step 5: Ejecutar toda la suite**

Run: `npm test`
Expected: PASS. Los 110 tests anteriores siguen verdes (incluido el snapshot
dorado, que no cambia porque `AuditResult` no cambia) y los 5 nuevos pasan (4
en Windows, donde el de symlink se omite).

- [ ] **Step 6: Commitear**

```bash
git add src/audit.ts tests/audit.test.ts
git commit -m "feat: collectAudit expone referencias y su completitud; findReferences no sigue symlinks"
```

---

## Task 4: Planner puro

**Files:**
- Create: `src/planner/plan.ts`
- Test: `tests/planner/plan.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from 'vitest';
import type { FileEntry, Finding, Inventory } from '../../src/core/types.js';
import {
  planOperations, DEFAULT_POLICY, EXECUTABLE_TYPES, type PlannerInput,
} from '../../src/planner/plan.js';

function entrada(p: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    path: p, absPath: `/r/${p}`, isDir: false, isSymlink: false, size: 10,
    mtimeMs: 0, depth: p.split('/').length, notDescended: false, ...extra,
  };
}

function hallazgo(p: string, extra: Partial<Finding> = {}): Finding {
  return {
    id: 'F-000001', ruleId: 'FS-TEMP-001', axis: 'filesystem', path: p,
    severity: 'low', risk: 'safe', confidence: 0.9,
    reason: 'Fichero de log abandonado', evidence: {},
    suggests: ['quarantine', 'review'], ...extra,
  };
}

function entradaPlanner(findings: Finding[], extra: Partial<PlannerInput> = {}): PlannerInput {
  const rutas = [...new Set(findings.map((f) => f.path))];
  const inventory: Inventory = {
    root: '/r', scannedAt: '', truncated: false,
    files: rutas.map((p) => entrada(p)), projects: [], gitByProject: {},
  };
  return {
    findings,
    inventory,
    referenced: new Set(),
    referencesComplete: true,
    hashes: new Map(rutas.map((p) => [p, `h-${p}`])),
    policy: DEFAULT_POLICY,
    ...extra,
  };
}

describe('planOperations', () => {
  it('propone cuarentena cuando no hay motivo para degradar', () => {
    const [op] = planOperations(entradaPlanner([hallazgo('debug.log')]));
    expect(op).toMatchObject({
      id: 'OP-000001', type: 'quarantine', path: 'debug.log', risk: 'safe',
      degradedFrom: null, degradeReason: null,
      source: { sha256: 'h-debug.log', size: 10 },
    });
  });

  it('riesgo unknown produce review y nada mas', () => {
    const [op] = planOperations(entradaPlanner([hallazgo('a.log', { risk: 'unknown' })]));
    expect(op).toMatchObject({ type: 'review', degradedFrom: 'quarantine', degradeReason: 'unknown-risk' });
  });

  it('confianza por debajo del umbral degrada a review', () => {
    const [op] = planOperations(entradaPlanner([hallazgo('a.log', { confidence: 0.5 })]));
    expect(op).toMatchObject({ type: 'review', degradeReason: 'low-confidence' });
  });

  it('el umbral es configurable', () => {
    const input = entradaPlanner([hallazgo('a.log', { confidence: 0.5 })], { policy: { minConfidence: 0.4 } });
    expect(planOperations(input)[0]?.type).toBe('quarantine');
  });

  it('nunca pone en cuarentena algo referenciado', () => {
    const input = entradaPlanner([hallazgo('a.log')], { referenced: new Set(['a.log']) });
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'referenced-by-source' });
  });

  it('nunca pone en cuarentena si las referencias no se pudieron determinar', () => {
    const input = entradaPlanner([hallazgo('a.log')], { referencesComplete: false });
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'references-undetermined' });
  });

  it('dentro de una frontera desconocida solo propone review', () => {
    const input = entradaPlanner([hallazgo('x/a.log'), hallazgo('xy/b.log', { id: 'F-000002' })]);
    input.inventory.projects = [
      { path: 'x', confidence: 0.5, markers: ['package.json'], status: 'unknown-boundary' },
    ];
    const ops = planOperations(input);
    expect(ops.find((o) => o.path === 'x/a.log'))
      .toMatchObject({ type: 'review', degradeReason: 'unknown-project-boundary' });
    expect(ops.find((o) => o.path === 'xy/b.log')?.type).toBe('quarantine');
  });

  it('si la raiz misma es frontera desconocida, nada va a cuarentena', () => {
    const input = entradaPlanner([hallazgo('a.log')]);
    input.inventory.projects = [
      { path: '.', confidence: 0.5, markers: ['package.json'], status: 'unknown-boundary' },
    ];
    expect(planOperations(input)[0]?.type).toBe('review');
  });

  it('un directorio no va a cuarentena', () => {
    const input = entradaPlanner([hallazgo('logs')]);
    input.inventory.files = [entrada('logs', { isDir: true })];
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'not-a-regular-file' });
  });

  it('sin huella no hay cuarentena', () => {
    const input = entradaPlanner([hallazgo('a.log')], { hashes: new Map([['a.log', null]]) });
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'hash-unavailable' });
  });

  it('una sugerencia review no se marca como degradada', () => {
    const [op] = planOperations(entradaPlanner([
      hallazgo('notas-final.md', { ruleId: 'FS-NAMING-001', suggests: ['review'], confidence: 0.7 }),
    ]));
    expect(op).toMatchObject({ type: 'review', degradedFrom: null, degradeReason: null });
  });

  it('none no produce operacion', () => {
    expect(planOperations(entradaPlanner([hallazgo('a.log', { suggests: ['none'] })]))).toEqual([]);
  });

  it('una ruta con sugerencias en conflicto produce una sola operacion review', () => {
    const ops = planOperations(entradaPlanner([
      hallazgo('debug-final.log', { id: 'F-000001' }),
      hallazgo('debug-final.log', {
        id: 'F-000002', ruleId: 'FS-NAMING-001', suggests: ['review'], risk: 'medium', confidence: 0.9,
      }),
    ]));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'review',
      degradedFrom: 'quarantine',
      degradeReason: 'conflicting-suggestions',
      risk: 'medium',
      ruleIds: ['FS-NAMING-001', 'FS-TEMP-001'],
      findingIds: ['F-000002', 'F-000001'],
    });
  });

  it('los IDs siguen el orden de ruta y no dependen del orden de entrada', () => {
    const fs = [
      hallazgo('b.log', { id: 'F-000001' }),
      hallazgo('a.log', { id: 'F-000002' }),
      hallazgo('c.log', { id: 'F-000003' }),
    ];
    const uno = planOperations(entradaPlanner(fs));
    const dos = planOperations(entradaPlanner([...fs].reverse()));
    expect(uno.map((o) => [o.id, o.path])).toEqual([
      ['OP-000001', 'a.log'], ['OP-000002', 'b.log'], ['OP-000003', 'c.log'],
    ]);
    expect(dos).toEqual(uno);
  });

  it('solo quarantine es ejecutable en esta version', () => {
    expect([...EXECUTABLE_TYPES]).toEqual(['quarantine']);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/planner/plan.test.ts`
Expected: FAIL, no se puede resolver `../../src/planner/plan.js`.

- [ ] **Step 3: Implementar `src/planner/plan.ts`**

```ts
import type {
  DegradeReason, FileEntry, Finding, Inventory, Operation, OperationType, Risk,
} from '../core/types.js';

/**
 * Tipos que el executor sabe aplicar en esta version. El resto se planifica
 * y se muestra, pero approve lo rechaza: ignore/move/create llegan con init.
 */
export const EXECUTABLE_TYPES: ReadonlySet<OperationType> = new Set<OperationType>(['quarantine']);

export interface PlannerPolicy {
  /** Por debajo de esta confianza toda operacion se degrada a review. */
  minConfidence: number;
}

export const DEFAULT_POLICY: PlannerPolicy = { minConfidence: 0.8 };

export interface PlannerInput {
  findings: Finding[];
  inventory: Inventory;
  referenced: Set<string>;
  referencesComplete: boolean;
  /** sha256 de los candidatos a cuarentena; null si no se pudo calcular. */
  hashes: Map<string, string | null>;
  policy: PlannerPolicy;
}

interface Resolution {
  type: OperationType;
  degradedFrom: OperationType | null;
  degradeReason: DegradeReason | null;
}

const RISK_RANK: Record<Risk, number> = { safe: 0, low: 1, medium: 2, high: 3, unknown: 4 };

// Comparacion por unidad de codigo, no localeCompare: el orden de los IDs no
// puede depender de la configuracion regional de la maquina.
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function insideUnknownBoundary(p: string, inventory: Inventory): boolean {
  return inventory.projects.some((c) =>
    c.status === 'unknown-boundary'
    && (c.path === '.' || p === c.path || p.startsWith(`${c.path}/`)));
}

/** Aplica las reglas del planner de la spec §6 a un hallazgo. */
function resolve(f: Finding, input: PlannerInput, byPath: Map<string, FileEntry>): Resolution {
  const primary: OperationType = f.suggests[0] ?? 'review';
  const degrade = (reason: DegradeReason): Resolution => (
    primary === 'review'
      ? { type: 'review', degradedFrom: null, degradeReason: null }
      : { type: 'review', degradedFrom: primary, degradeReason: reason });

  if (f.risk === 'unknown') return degrade('unknown-risk');
  if (primary === 'none') return { type: 'none', degradedFrom: null, degradeReason: null };
  if (insideUnknownBoundary(f.path, input.inventory)) return degrade('unknown-project-boundary');
  if (f.confidence < input.policy.minConfidence) return degrade('low-confidence');

  if (primary === 'quarantine') {
    const entry = byPath.get(f.path);
    if (!entry || entry.isDir || entry.isSymlink || entry.notDescended) return degrade('not-a-regular-file');
    if (input.referenced.has(f.path)) return degrade('referenced-by-source');
    if (!input.referencesComplete) return degrade('references-undetermined');
    if (!input.hashes.get(f.path)) return degrade('hash-unavailable');
  }
  return { type: primary, degradedFrom: null, degradeReason: null };
}

/** Varias reglas sobre la misma ruta: si no coinciden, gana review. */
function merge(resolutions: Resolution[]): Resolution {
  const types = [...new Set(resolutions.map((r) => r.type))].filter((t) => t !== 'none');
  if (types.length === 0) return { type: 'none', degradedFrom: null, degradeReason: null };
  if (types.length === 1) {
    const type = types[0]!;
    const degraded = resolutions.find((r) => r.type === type && r.degradedFrom !== null);
    return degraded ?? { type, degradedFrom: null, degradeReason: null };
  }
  const firstActive = types.find((t) => t !== 'review') ?? null;
  return { type: 'review', degradedFrom: firstActive, degradeReason: 'conflicting-suggestions' };
}

/**
 * Convierte hallazgos en operaciones. Funcion pura y determinista: el mismo
 * inventario y los mismos hallazgos producen los mismos IDs.
 */
export function planOperations(input: PlannerInput): Operation[] {
  const byPath = new Map(input.inventory.files.map((e) => [e.path, e]));
  const sorted = [...input.findings].sort((a, b) =>
    byCodeUnit(a.path, b.path) || byCodeUnit(a.ruleId, b.ruleId) || byCodeUnit(a.id, b.id));

  const groups = new Map<string, Finding[]>();
  for (const f of sorted) {
    const list = groups.get(f.path) ?? [];
    list.push(f);
    groups.set(f.path, list);
  }

  const ops: Operation[] = [];
  for (const [p, group] of groups) {
    const r = merge(group.map((f) => resolve(f, input, byPath)));
    if (r.type === 'none') continue;
    const risk = group.reduce<Risk>(
      (acc, f) => (RISK_RANK[f.risk] > RISK_RANK[acc] ? f.risk : acc), 'safe');
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
      source: { sha256: input.hashes.get(p) ?? null, size: byPath.get(p)?.size ?? 0 },
    });
  }
  return ops;
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/planner/plan.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commitear**

```bash
git add src/planner/plan.ts tests/planner/plan.test.ts
git commit -m "feat: planner puro con las degradaciones de la spec 6"
```

---

## Task 5: `runPlan`, informe y comando `plan` read-only

**Files:**
- Create: `src/plan.ts`, `src/report/plan.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/planner/run-plan.test.ts`, `tests/report/plan.test.ts`, `tests/cli/cli.test.ts`, `tests/invariants/read-only.test.ts`, `tests/invariants/no-secret-leak.test.ts`

- [ ] **Step 1: Escribir el test de `runPlan` que falla**

`tests/planner/run-plan.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPlan } from '../../src/plan.js';

const RULES = path.join(process.cwd(), 'rules');
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-plan-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function logViejo(nombre: string, contenido: string): Promise<void> {
  const p = path.join(root, nombre);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}

describe('runPlan', () => {
  it('propone cuarentena para un log abandonado, con la huella real del fichero', async () => {
    await logViejo('debug.log', 'contenido del log');
    const { plan } = await runPlan({ root, rulesDir: RULES });
    const op = plan.operations.find((o) => o.path === 'debug.log');
    expect(op?.type).toBe('quarantine');
    expect(op?.id).toBe('OP-000001');
    expect(op?.source.sha256).toBe(createHash('sha256').update('contenido del log').digest('hex'));
    expect(op?.source.size).toBe(Buffer.byteLength('contenido del log'));
  });

  it('degrada a review si algun fichero fuente referencia el log', async () => {
    await logViejo('debug.log', 'x');
    await writeFile(path.join(root, 'README.md'), 'Los errores van a debug.log');
    const { plan } = await runPlan({ root, rulesDir: RULES });
    const op = plan.operations.find((o) => o.path === 'debug.log');
    expect(op?.type).toBe('review');
    expect(op?.degradeReason).toBe('referenced-by-source');
  });

  it('el mismo estado de disco produce el mismo plan', async () => {
    await logViejo('debug.log', 'x');
    const a = await runPlan({ root, rulesDir: RULES });
    const b = await runPlan({ root, rulesDir: RULES });
    expect(a.plan.planId).toBe(b.plan.planId);
    expect(a.plan.operations).toEqual(b.plan.operations);
  });
});
```

- [ ] **Step 2: Escribir el test del informe que falla**

`tests/report/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Operation, Plan } from '../../src/core/types.js';
import { renderPlan } from '../../src/report/plan.js';

function op(extra: Partial<Operation>): Operation {
  return {
    id: 'OP-000001', type: 'quarantine', path: 'debug.log', findingIds: ['F-000001'],
    ruleIds: ['FS-TEMP-001'], risk: 'safe', reason: 'Fichero de log abandonado',
    degradedFrom: null, degradeReason: null, source: { sha256: 'abc', size: 1 }, ...extra,
  };
}

function plan(operations: Operation[]): Plan {
  return {
    planId: '0123456789abcdef', root: '/ws', createdAt: '2026-09-26T00:00:00.000Z',
    engineVersion: '0.1.0', minConfidence: 0.8, operations,
  };
}

describe('renderPlan', () => {
  it('lista cada operacion con su ID, tipo y ruta', () => {
    const s = renderPlan(plan([op({})]));
    expect(s).toContain('OP-000001');
    expect(s).toContain('quarantine');
    expect(s).toContain('debug.log');
    expect(s).toContain('Aprobables: OP-000001');
  });

  it('explica por que se degrado una operacion', () => {
    const s = renderPlan(plan([op({ type: 'review', degradedFrom: 'quarantine', degradeReason: 'referenced-by-source' })]));
    expect(s).toContain('degradada desde quarantine: referenced-by-source');
    expect(s).not.toContain('Aprobables');
  });

  it('un plan vacio lo dice y recuerda que no ha modificado nada', () => {
    const s = renderPlan(plan([]));
    expect(s).toContain('Sin operaciones propuestas.');
    expect(s).toContain('Este comando no ha modificado nada.');
  });
});
```

- [ ] **Step 3: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/planner/run-plan.test.ts tests/report/plan.test.ts`
Expected: FAIL, no se pueden resolver `src/plan.js` ni `src/report/plan.js`.

- [ ] **Step 4: Implementar `src/plan.ts`**

```ts
import { createHash } from 'node:crypto';
import type { AuditResult, Operation, Plan } from './core/types.js';
import type { Limits } from './core/limits.js';
import { ENGINE_VERSION } from './core/version.js';
import { collectAudit } from './audit.js';
import { planOperations, DEFAULT_POLICY, type PlannerPolicy } from './planner/plan.js';

export interface PlanOptions {
  root: string;
  rulesDir: string;
  limits?: Partial<Limits>;
  minConfidence?: number;
}

export interface PlanRun {
  audit: AuditResult;
  plan: Plan;
}

/** Huella del plan: cambia si cambia cualquier operacion, su tipo, ruta u origen. */
export function planDigest(root: string, operations: Operation[]): string {
  const canonical = JSON.stringify({
    root,
    ops: operations.map((o) => [o.id, o.type, o.path, o.source.sha256]),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Read-only por contrato (NN-4): audita, calcula las huellas de los
 * candidatos a cuarentena y propone. No escribe un solo byte.
 */
export async function runPlan(options: PlanOptions): Promise<PlanRun> {
  const { result, facts } = await collectAudit(options);
  const byPath = new Map(result.inventory.files.map((e) => [e.path, e]));

  const hashes = new Map<string, string | null>();
  for (const f of result.findings) {
    if (f.suggests[0] !== 'quarantine' || hashes.has(f.path)) continue;
    const entry = byPath.get(f.path);
    hashes.set(f.path, entry && !entry.isDir && !entry.isSymlink
      ? await facts.content.hash(entry)
      : null);
  }

  const policy: PlannerPolicy = {
    ...DEFAULT_POLICY,
    ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
  };
  const operations = planOperations({
    findings: result.findings,
    inventory: result.inventory,
    referenced: facts.referenced,
    referencesComplete: facts.referencesComplete,
    hashes,
    policy,
  });

  return {
    audit: result,
    plan: {
      planId: planDigest(result.inventory.root, operations),
      root: result.inventory.root,
      createdAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      minConfidence: policy.minConfidence,
      operations,
    },
  };
}
```

- [ ] **Step 5: Implementar `src/report/plan.ts`**

```ts
import type { Plan } from '../core/types.js';
import { EXECUTABLE_TYPES } from '../planner/plan.js';

// Igual que report/human.ts: solo se imprimen campos conocidos (ID, tipo,
// riesgo, ruta, IDs de regla y titulos fijos de regla). Nunca evidencia.
export function renderPlan(plan: Plan): string {
  const out: string[] = [];
  out.push(`Plan ${plan.planId}  ${plan.operations.length} operaciones  umbral de confianza ${plan.minConfidence}`);
  out.push('');

  if (plan.operations.length === 0) out.push('Sin operaciones propuestas.');

  for (const op of plan.operations) {
    out.push(`  ${op.id}  ${op.type.padEnd(10)} ${op.risk.padEnd(7)} ${op.path}`);
    out.push(`             ${op.ruleIds.join(', ')}  ${op.reason}`);
    if (op.degradedFrom && op.degradeReason) {
      out.push(`             degradada desde ${op.degradedFrom}: ${op.degradeReason}`);
    }
  }

  const approvable = plan.operations.filter((o) => EXECUTABLE_TYPES.has(o.type)).map((o) => o.id);
  out.push('');
  if (approvable.length > 0) {
    out.push(`Aprobables: ${approvable.join(' ')}`);
    out.push(`Para aprobar: hygiene approve <OP-ID...> --root "${plan.root}"`);
  }
  out.push('Este comando no ha modificado nada.');
  return out.join('\n');
}
```

- [ ] **Step 6: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/planner/run-plan.test.ts tests/report/plan.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Escribir los tests de CLI que fallan**

Añadir dentro del `describe('main', ...)` de `tests/cli/cli.test.ts`:

```ts
  it('plan sobre un arbol limpio devuelve 0 y no propone nada', async () => {
    const code = await main(['plan', root], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('Sin operaciones propuestas.');
  });

  it('plan --json emite el plan con sus operaciones', async () => {
    await writeFile(path.join(root, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----');
    const code = await main(['plan', root, '--json'], print);
    expect(code).toBe(1);
    const plan = JSON.parse(salida.join('\n')) as { operations: { path: string }[] };
    expect(plan.operations.some((o) => o.path === 'id_rsa')).toBe(true);
  });
```

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: FAIL, `plan` es un comando desconocido y devuelve 2.

- [ ] **Step 8: Añadir el comando `plan` a `src/cli/index.ts`**

Añadir las importaciones junto a las existentes:

```ts
import { runPlan } from '../plan.js';
import { renderPlan } from '../report/plan.js';
```

En `USAGE`, añadir tras la línea de `audit`:

```
  plan [ruta]            Operaciones propuestas con ID, sin modificar nada
```

Añadir este helper antes de `main`:

```ts
async function resolveDir(target: string | undefined, print: Printer): Promise<string | null> {
  const root = path.resolve(target ?? process.cwd());
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    print(`La ruta no existe: ${root}`);
    return null;
  }
  if (!rootStat.isDirectory()) {
    print(`La ruta no es un directorio: ${root}`);
    return null;
  }
  return root;
}
```

Sustituir el bloque `if (command === 'scan' || command === 'audit') { ... }`
entero por:

```ts
    if (command === 'scan' || command === 'audit') {
      const root = await resolveDir(target, print);
      if (!root) return 2;

      const result = await runAudit({ root, rulesDir: RULES_DIR });

      if (command === 'scan') {
        print(JSON.stringify(result.inventory, replacer, 2));
        return 0;
      }

      print(json ? JSON.stringify(result, replacer, 2) : renderReport(result));
      return result.score.clean ? 0 : 1;
    }

    if (command === 'plan') {
      const root = await resolveDir(target, print);
      if (!root) return 2;
      const { audit, plan } = await runPlan({ root, rulesDir: RULES_DIR });
      print(json ? JSON.stringify(plan, null, 2) : renderPlan(plan));
      return audit.score.clean ? 0 : 1;
    }
```

- [ ] **Step 9: Ejecutar los tests de CLI**

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: PASS, incluidos los tests anteriores de rutas inexistentes y de
ficheros como raíz, que ahora pasan por `resolveDir`.

- [ ] **Step 10: Extender el test de invariante NN-4 a `plan`**

En `tests/invariants/read-only.test.ts`:

1. Añadir `'utimes', 'lutimes', 'chown', 'lchown'` al final de
   `ESCRITURAS_ASYNC` y `'utimesSync', 'lutimesSync', 'chownSync', 'lchownSync'`
   al final de `ESCRITURAS_SYNC`. Cambiar metadatos también es escribir, y el
   executor usa `chown`.
2. Cambiar la importación de cabecera a
   `import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';`.
3. Añadir debajo de `const { runAudit } = await import('../../src/audit.js');`:

```ts
const { runPlan } = await import('../../src/plan.js');
```

4. Añadir este `describe` después del existente:

```ts
describe('NN-4: plan es read-only', () => {
  it('no invoca ninguna operacion de escritura aunque proponga cuarentenas', async () => {
    const log = path.join(root, 'debug.log');
    await writeFile(log, 'x');
    const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await utimes(log, viejo, viejo);

    // Limpieza tras el setup, igual que en el test de audit (guia (b) al pie).
    for (const fn of Object.values(asyncSpies)) fn.mockClear();
    for (const fn of Object.values(syncSpies)) fn.mockClear();

    // Asercion positiva: el plan tiene que haber propuesto algo ejecutable,
    // si no, "no escribio" no probaria nada.
    const { plan } = await runPlan({ root, rulesDir: path.join(process.cwd(), 'rules') });
    expect(plan.operations.some((o) => o.type === 'quarantine')).toBe(true);

    const usados = [...Object.entries(asyncSpies), ...Object.entries(syncSpies)]
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([name]) => name);
    expect(usados, 'plan escribio en disco').toHaveLength(0);
  });
});
```

- [ ] **Step 11: Extender el test de redacción de secretos a `plan`**

En `tests/invariants/no-secret-leak.test.ts`, añadir la importación
`import { runPlan } from '../../src/plan.js';` y este test dentro del
`describe` existente. Reutiliza la constante `SECRETO` del fichero: no se añade
ningún literal nuevo que dispare el escáner de secretos de GitHub.

```ts
  it('el plan serializado tampoco contiene el secreto', async () => {
    await run('git', ['init', '-b', 'main'], { cwd: root });
    await run('git', ['config', 'user.email', 't@t.t'], { cwd: root });
    await run('git', ['config', 'user.name', 'T'], { cwd: root });
    await writeFile(path.join(root, 'config.ts'), `export const KEY = "${SECRETO}";\n`);
    await run('git', ['add', 'config.ts'], { cwd: root });
    await run('git', ['commit', '-m', 'x'], { cwd: root });

    const { plan } = await runPlan({ root, rulesDir: path.join(process.cwd(), 'rules') });
    expect(plan.operations.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).not.toContain(SECRETO);
  });
```

- [ ] **Step 12: Ejecutar toda la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 13: Commitear**

```bash
git add src/plan.ts src/report/plan.ts src/cli/index.ts tests/planner/run-plan.test.ts tests/report/plan.test.ts tests/cli/cli.test.ts tests/invariants/read-only.test.ts tests/invariants/no-secret-leak.test.ts
git commit -m "feat: hygiene plan read-only con test de invariante NN-4 y de redaccion"
```

---

## Task 6: Almacén de aprobaciones

**Files:**
- Create: `src/approvals/store.ts`
- Test: `tests/approvals/store.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  approvalFile, deleteApprovals, loadApprovals, rootKey, saveApprovals,
  ApprovalFileError, type ApprovalRecord,
} from '../../src/approvals/store.js';
import { HomeInsideWorkspaceError } from '../../src/core/home.js';

let base: string;
let home: string;
let ws: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-apr-'));
  home = path.join(base, 'home');
  ws = path.join(base, 'ws');
  await mkdir(ws);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

function registro(extra: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schema_version: 1,
    root: ws,
    planId: '0123456789abcdef',
    updatedAt: '2026-09-26T00:00:00.000Z',
    requests: [],
    operations: [{
      id: 'OP-000001', type: 'quarantine', path: 'debug.log', sha256: 'abc',
      size: 1, risk: 'safe', ruleIds: ['FS-TEMP-001'],
    }],
    ...extra,
  };
}

describe('almacen de aprobaciones', () => {
  it('guarda y vuelve a leer el mismo registro', async () => {
    const file = await saveApprovals(home, registro());
    expect(file).toBe(approvalFile(home, ws));
    expect(await loadApprovals(home, ws)).toEqual(registro());
  });

  it('no deja ficheros temporales', async () => {
    await saveApprovals(home, registro());
    expect(await readdir(path.join(home, 'approvals'))).toEqual([`${rootKey(ws)}.json`]);
  });

  it('devuelve null si no hay aprobaciones', async () => {
    expect(await loadApprovals(home, ws)).toBeNull();
  });

  it('un fichero corrupto es un error, no un registro vacio', async () => {
    await mkdir(path.join(home, 'approvals'), { recursive: true });
    await writeFile(approvalFile(home, ws), '{ no es json');
    await expect(loadApprovals(home, ws)).rejects.toBeInstanceOf(ApprovalFileError);
  });

  it('un registro de otro workspace es un error', async () => {
    await mkdir(path.join(home, 'approvals'), { recursive: true });
    await writeFile(approvalFile(home, ws), JSON.stringify(registro({ root: path.join(base, 'otro') })));
    await expect(loadApprovals(home, ws)).rejects.toBeInstanceOf(ApprovalFileError);
  });

  it('deleteApprovals informa si habia algo que borrar', async () => {
    expect(await deleteApprovals(home, ws)).toBe(false);
    await saveApprovals(home, registro());
    expect(await deleteApprovals(home, ws)).toBe(true);
    expect(await loadApprovals(home, ws)).toBeNull();
  });

  it('se niega a escribir si la base cae dentro del workspace', async () => {
    await expect(saveApprovals(path.join(ws, '.hygiene'), registro()))
      .rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('la clave depende de la ruta del workspace', () => {
    expect(rootKey(ws)).toBe(rootKey(ws));
    expect(rootKey(ws)).not.toBe(rootKey(path.join(base, 'otro')));
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/approvals/store.test.ts`
Expected: FAIL, no se puede resolver `src/approvals/store.js`.

- [ ] **Step 3: Implementar `src/approvals/store.ts`**

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OperationType, Risk } from '../core/types.js';
import { assertHomeOutside } from '../core/home.js';

export interface ApprovedOperation {
  /** ID en el plan al aprobarse. Informativo: la identidad es tipo + ruta + hash. */
  id: string;
  type: OperationType;
  path: string;
  sha256: string;
  size: number;
  risk: Risk;
  ruleIds: string[];
}

export interface ApprovalRequest {
  at: string;
  /** Lo que pidio el usuario, p. ej. ['--risk', 'safe'] u ['OP-000001']. */
  args: string[];
  /** Los IDs concretos en que se materializo (spec §9). */
  expanded: string[];
}

export interface ApprovalRecord {
  schema_version: 1;
  root: string;
  planId: string;
  updatedAt: string;
  requests: ApprovalRequest[];
  operations: ApprovedOperation[];
}

export class ApprovalFileError extends Error {}

function normalizeRoot(root: string): string {
  const abs = path.resolve(root);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

export function approvalsDir(home: string): string {
  return path.join(home, 'approvals');
}

export function rootKey(root: string): string {
  return createHash('sha256').update(normalizeRoot(root)).digest('hex').slice(0, 16);
}

export function approvalFile(home: string, root: string): string {
  return path.join(approvalsDir(home), `${rootKey(root)}.json`);
}

/** Identidad de una operacion aprobada. */
export function approvalKey(op: { type: OperationType; path: string; sha256: string | null }): string {
  return `${op.type}\u0000${op.path}\u0000${op.sha256 ?? ''}`;
}

export async function loadApprovals(home: string, root: string): Promise<ApprovalRecord | null> {
  const file = approvalFile(home, root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ApprovalFileError(`fichero de aprobaciones corrupto: ${file}`);
  }
  const rec = data as Partial<ApprovalRecord> | null;
  if (!rec || rec.schema_version !== 1 || !Array.isArray(rec.operations) || typeof rec.root !== 'string') {
    throw new ApprovalFileError(`fichero de aprobaciones con formato desconocido: ${file}`);
  }
  if (normalizeRoot(rec.root) !== normalizeRoot(root)) {
    throw new ApprovalFileError(`el fichero ${file} pertenece a otro workspace: ${rec.root}`);
  }
  return rec as ApprovalRecord;
}

/** Unico punto de escritura de approve: solo toca <home>/approvals/. */
export async function saveApprovals(home: string, record: ApprovalRecord): Promise<string> {
  await assertHomeOutside(home, record.root);
  const file = approvalFile(home, record.root);
  await mkdir(approvalsDir(home), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
  return file;
}

export async function deleteApprovals(home: string, root: string): Promise<boolean> {
  try {
    await rm(approvalFile(home, root));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/approvals/store.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commitear**

```bash
git add src/approvals/store.ts tests/approvals/store.test.ts
git commit -m "feat: almacen de aprobaciones por workspace en HYGIENE_HOME/approvals"
```

---

## Task 7: Selección de aprobaciones y comando `approve`

**Files:**
- Create: `src/approvals/approve.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/approvals/approve.test.ts`, `tests/cli/cli.test.ts`, `tests/invariants/approve-boundary.test.ts`

- [ ] **Step 1: Escribir los tests puros que fallan**

`tests/approvals/approve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Operation, Plan } from '../../src/core/types.js';
import { selectOperations, mergeApproval } from '../../src/approvals/approve.js';

function op(id: string, extra: Partial<Operation> = {}): Operation {
  return {
    id, type: 'quarantine', path: `${id}.log`, findingIds: [], ruleIds: ['FS-TEMP-001'],
    risk: 'safe', reason: 'r', degradedFrom: null, degradeReason: null,
    source: { sha256: `h-${id}`, size: 1 }, ...extra,
  };
}

const PLAN: Plan = {
  planId: 'p', root: '/ws', createdAt: '', engineVersion: '0.1.0', minConfidence: 0.8,
  operations: [
    op('OP-000001'),
    op('OP-000002', { risk: 'low' }),
    op('OP-000003', { risk: 'medium' }),
    op('OP-000004', { type: 'review', source: { sha256: null, size: 1 } }),
  ],
};

const ids = (ops: Operation[]) => ops.map((o) => o.id);

describe('selectOperations', () => {
  it('selecciona por ID', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: ['OP-000002'] }).selected)).toEqual(['OP-000002']);
  });

  it('un ID inexistente anula toda la seleccion', () => {
    const r = selectOperations({ plan: PLAN, ids: ['OP-000001', 'OP-000099'] });
    expect(r.selected).toEqual([]);
    expect(r.errors[0]).toContain('OP-000099');
  });

  it('una operacion review no se aprueba', () => {
    const r = selectOperations({ plan: PLAN, ids: ['OP-000004'] });
    expect(r.selected).toEqual([]);
    expect(r.errors[0]).toContain('review');
  });

  it('--risk safe se expande solo a operaciones safe', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: [], risk: 'safe' }).selected)).toEqual(['OP-000001']);
  });

  it('--risk medium incluye safe, low y medium', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: [], risk: 'medium' }).selected))
      .toEqual(['OP-000001', 'OP-000002', 'OP-000003']);
  });

  it('IDs y --risk se suman sin duplicar', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: ['OP-000001', 'OP-000003'], risk: 'safe' }).selected))
      .toEqual(['OP-000001', 'OP-000003']);
  });
});

describe('mergeApproval', () => {
  const ahora = new Date('2026-09-26T10:00:00.000Z');

  it('materializa la expansion de --risk como lista explicita de IDs', () => {
    const rec = mergeApproval(null, PLAN, [PLAN.operations[0]!], ['--risk', 'safe'], ahora);
    expect(rec.requests).toEqual([{ at: ahora.toISOString(), args: ['--risk', 'safe'], expanded: ['OP-000001'] }]);
    expect(rec.operations).toEqual([{
      id: 'OP-000001', type: 'quarantine', path: 'OP-000001.log', sha256: 'h-OP-000001',
      size: 1, risk: 'safe', ruleIds: ['FS-TEMP-001'],
    }]);
    expect(rec.root).toBe('/ws');
  });

  it('acumula aprobaciones sin duplicar la misma operacion', () => {
    const [a, b] = PLAN.operations;
    const uno = mergeApproval(null, PLAN, [a!], ['OP-000001'], ahora);
    const dos = mergeApproval(uno, PLAN, [a!, b!], ['OP-000001', 'OP-000002'], ahora);
    expect(dos.operations.map((o) => o.id)).toEqual(['OP-000001', 'OP-000002']);
    expect(dos.requests).toHaveLength(2);
  });

  it('una operacion ejecutable sin huella rompe un invariante', () => {
    expect(() => mergeApproval(null, PLAN, [op('OP-000009', { source: { sha256: null, size: 0 } })], [], ahora))
      .toThrow(/sin huella/);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/approvals/approve.test.ts`
Expected: FAIL, no se puede resolver `src/approvals/approve.js`.

- [ ] **Step 3: Implementar `src/approvals/approve.ts`**

```ts
import type { Operation, Plan } from '../core/types.js';
import { EXECUTABLE_TYPES } from '../planner/plan.js';
import { approvalKey, type ApprovalRecord, type ApprovedOperation } from './store.js';

/** Niveles que acepta --risk, de menor a mayor. unknown nunca se aprueba por filtro. */
export const APPROVABLE_RISKS = ['safe', 'low', 'medium', 'high'] as const;
export type ApprovableRisk = typeof APPROVABLE_RISKS[number];

export interface SelectRequest {
  plan: Plan;
  ids: string[];
  /** Atajo: todo lo ejecutable con riesgo igual o menor. Se expande a IDs. */
  risk?: ApprovableRisk;
}

export interface Selection {
  selected: Operation[];
  errors: string[];
}

/** Todo o nada: con un solo error no se selecciona ninguna operacion. */
export function selectOperations(req: SelectRequest): Selection {
  const errors: string[] = [];
  const chosen = new Map<string, Operation>();
  const byId = new Map(req.plan.operations.map((o) => [o.id, o]));

  for (const id of req.ids) {
    const op = byId.get(id);
    if (!op) {
      errors.push(`${id} no existe en el plan actual`);
      continue;
    }
    if (!EXECUTABLE_TYPES.has(op.type)) {
      errors.push(`${id} es de tipo ${op.type}: no es ejecutable en esta version y no se aprueba`);
      continue;
    }
    chosen.set(op.id, op);
  }

  if (req.risk) {
    const limit = APPROVABLE_RISKS.indexOf(req.risk);
    for (const op of req.plan.operations) {
      if (!EXECUTABLE_TYPES.has(op.type) || op.risk === 'unknown') continue;
      if (APPROVABLE_RISKS.indexOf(op.risk) <= limit) chosen.set(op.id, op);
    }
  }

  if (errors.length > 0) return { selected: [], errors };
  const selected = [...chosen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { selected, errors };
}

export function mergeApproval(
  existing: ApprovalRecord | null,
  plan: Plan,
  selected: Operation[],
  args: string[],
  now: Date,
): ApprovalRecord {
  const ops = new Map<string, ApprovedOperation>();
  for (const a of existing?.operations ?? []) ops.set(approvalKey(a), a);

  for (const op of selected) {
    if (!op.source.sha256) {
      throw new Error(`invariante roto: ${op.id} es ejecutable pero no tiene huella; sin huella no hay restore verificable`);
    }
    const approved: ApprovedOperation = {
      id: op.id,
      type: op.type,
      path: op.path,
      sha256: op.source.sha256,
      size: op.source.size,
      risk: op.risk,
      ruleIds: op.ruleIds,
    };
    ops.set(approvalKey(approved), approved);
  }

  const at = now.toISOString();
  return {
    schema_version: 1,
    root: plan.root,
    planId: plan.planId,
    updatedAt: at,
    requests: [...(existing?.requests ?? []), { at, args, expanded: selected.map((o) => o.id) }],
    operations: [...ops.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)),
  };
}
```

- [ ] **Step 4: Ejecutar los tests puros y verlos pasar**

Run: `npx vitest run tests/approvals/approve.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Preparar `tests/cli/cli.test.ts` para usar una base temporal**

Los comandos que escriben no pueden tocar el `~/.hygiene` real de quien ejecuta
los tests. Sustituir la cabecera del fichero, desde los `import` hasta el
`afterEach` inclusive, por:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';

let root: string;
let home: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };
const homePrevio = process.env.HYGIENE_HOME;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-cli-'));
  home = await mkdtemp(path.join(tmpdir(), 'hyg-cli-home-'));
  process.env.HYGIENE_HOME = home;
  salida = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
  if (homePrevio === undefined) delete process.env.HYGIENE_HOME;
  else process.env.HYGIENE_HOME = homePrevio;
});

async function logViejo(nombre: string, contenido = 'x'): Promise<void> {
  const p = path.join(root, nombre);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}
```

- [ ] **Step 6: Escribir los tests de CLI de `approve` que fallan**

Añadir dentro del `describe('main', ...)`:

```ts
  it('approve sin IDs ni --risk devuelve 2', async () => {
    expect(await main(['approve', '--root', root], print)).toBe(2);
  });

  it('approve con --risk invalido devuelve 2', async () => {
    expect(await main(['approve', '--risk', 'unknown', '--root', root], print)).toBe(2);
  });

  it('approve --risk safe registra la aprobacion en HYGIENE_HOME', async () => {
    await logViejo('debug.log');
    const code = await main(['approve', '--risk', 'safe', '--root', root], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('Aprobadas: OP-000001');
    expect(await readdir(path.join(home, 'approvals'))).toHaveLength(1);
  });

  it('approve de un ID inexistente devuelve 2 y no registra nada', async () => {
    expect(await main(['approve', 'OP-000099', '--root', root], print)).toBe(2);
    await expect(readdir(path.join(home, 'approvals'))).rejects.toThrow();
  });

  it('approve --reset descarta las aprobaciones pendientes', async () => {
    await logViejo('debug.log');
    await main(['approve', '--risk', 'safe', '--root', root], print);
    expect(await main(['approve', '--reset', '--root', root], print)).toBe(0);
    expect(await readdir(path.join(home, 'approvals'))).toHaveLength(0);
  });
```

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: FAIL. `parseArgs` rechaza `--root` porque no es una opción declarada.

- [ ] **Step 7: Añadir `approve` a `src/cli/index.ts`**

Añadir las importaciones:

```ts
import { resolveHome } from '../core/home.js';
import { deleteApprovals, loadApprovals, saveApprovals } from '../approvals/store.js';
import {
  APPROVABLE_RISKS, mergeApproval, selectOperations, type ApprovableRisk,
} from '../approvals/approve.js';
```

Sustituir el objeto `options` de `parseArgs` por:

```ts
      options: {
        json: { type: 'boolean' },
        help: { type: 'boolean' },
        root: { type: 'string' },
        risk: { type: 'string' },
        reset: { type: 'boolean' },
      },
```

En `USAGE`, añadir tras la línea de `explain`:

```
  approve <OP-ID...>     Registra aprobaciones (o --risk <nivel>, o --reset)
```

sustituir la línea de `--json` y la de `--help` de la sección `Opciones` por:

```
  --json                 Salida legible por maquina
  --root <ruta>          Workspace para approve y clean (por defecto, el actual)
  --risk <nivel>         approve: todo lo ejecutable hasta ese riesgo (safe, low, medium, high)
  --reset                approve: descarta las aprobaciones pendientes
  --help                 Esta ayuda

Entorno:
  HYGIENE_HOME           Base de cuarentena y aprobaciones (por defecto ~/.hygiene)
```

Añadir este bloque justo después del bloque de `plan`:

```ts
    if (command === 'approve') {
      const root = await resolveDir(parsed.values.root, print);
      if (!root) return 2;
      const home = resolveHome();

      if (parsed.values.reset === true) {
        const borrado = await deleteApprovals(home, root);
        print(borrado ? 'Aprobaciones pendientes descartadas.' : 'No habia aprobaciones pendientes.');
        return 0;
      }

      const ids = parsed.positionals.slice(1);
      const risk = parsed.values.risk;
      if (risk !== undefined && !(APPROVABLE_RISKS as readonly string[]).includes(risk)) {
        print(`--risk no valido: ${risk}. Valores: ${APPROVABLE_RISKS.join(', ')}`);
        return 2;
      }
      if (ids.length === 0 && risk === undefined) {
        print('Indica IDs de operacion o --risk <nivel>.');
        return 2;
      }

      const { plan } = await runPlan({ root, rulesDir: RULES_DIR });
      const { selected, errors } = selectOperations({
        plan, ids, risk: risk as ApprovableRisk | undefined,
      });
      if (errors.length > 0) {
        for (const e of errors) print(e);
        print('No se ha registrado ninguna aprobacion.');
        return 2;
      }
      if (selected.length === 0) {
        print('Ninguna operacion aprobable coincide. No se ha registrado nada.');
        return 0;
      }

      const record = mergeApproval(await loadApprovals(home, root), plan, selected, argv.slice(1), new Date());
      const file = await saveApprovals(home, record);
      print(`Aprobadas: ${selected.map((o) => o.id).join(' ')}`);
      print(`Registrado en ${file}`);
      print(`Para ejecutar: hygiene clean --approved --root "${root}"`);
      return 0;
    }
```

- [ ] **Step 8: Ejecutar los tests de CLI**

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: PASS.

- [ ] **Step 9: Escribir el test de frontera de `approve`**

La spec (§3) dice que `approve` escribe solo en `~/.hygiene/approvals/`. Este
test lo comprueba con el mismo mecanismo de intercepción que
`read-only.test.ts` (ver la nota técnica de ese fichero sobre `vi.mock`).

`tests/invariants/approve-boundary.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { ESCRITURAS_ASYNC, ESCRITURAS_SYNC } = vi.hoisted(() => ({
  ESCRITURAS_ASYNC: [
    'writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink',
    'rename', 'copyFile', 'chmod', 'truncate', 'symlink',
    'open', 'write', 'ftruncate', 'cp', 'link', 'mkdtemp',
    'utimes', 'lutimes', 'chown', 'lchown',
  ] as const,
  ESCRITURAS_SYNC: [
    'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync',
    'unlinkSync', 'renameSync', 'copyFileSync', 'chmodSync', 'truncateSync',
    'writeSync', 'ftruncateSync', 'cpSync', 'linkSync', 'mkdtempSync',
    'createWriteStream', 'utimesSync', 'lutimesSync', 'chownSync', 'lchownSync',
  ] as const,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = ReturnType<typeof vi.fn<(...args: any[]) => any>>;

const { asyncSpies, syncSpies } = vi.hoisted(() => ({
  asyncSpies: {} as Record<string, MockFn>,
  syncSpies: {} as Record<string, MockFn>,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of ESCRITURAS_ASYNC) {
    const original = (actual as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
    const fn = vi.fn(original);
    asyncSpies[name] = fn;
    wrapped[name] = fn;
  }
  return { ...wrapped, default: wrapped };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of ESCRITURAS_SYNC) {
    const original = (actual as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
    const fn = vi.fn(original);
    syncSpies[name] = fn;
    wrapped[name] = fn;
  }
  return { ...wrapped, default: wrapped };
});

const { main } = await import('../../src/cli/index.js');

// Funciones cuyo segundo argumento tambien es una ruta de destino.
const DOS_RUTAS = new Set(['rename', 'renameSync', 'copyFile', 'copyFileSync', 'link', 'linkSync', 'symlink']);

let root: string;
let home: string;
const homePrevio = process.env.HYGIENE_HOME;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-bnd-'));
  home = await mkdtemp(path.join(tmpdir(), 'hyg-bnd-home-'));
  process.env.HYGIENE_HOME = home;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
  if (homePrevio === undefined) delete process.env.HYGIENE_HOME;
  else process.env.HYGIENE_HOME = homePrevio;
});

describe('approve escribe solo en approvals/', () => {
  it('ninguna escritura cae fuera de HYGIENE_HOME/approvals', async () => {
    const log = path.join(root, 'debug.log');
    await writeFile(log, 'x');
    const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await utimes(log, viejo, viejo);
    for (const fn of Object.values(asyncSpies)) fn.mockClear();
    for (const fn of Object.values(syncSpies)) fn.mockClear();

    const code = await main(['approve', '--risk', 'safe', '--root', root], () => {});
    expect(code).toBe(0);

    const approvals = path.join(home, 'approvals');
    const llamadas = [...Object.entries(asyncSpies), ...Object.entries(syncSpies)]
      .flatMap(([name, fn]) => fn.mock.calls.map((args) => ({ name, args })));

    // Asercion positiva: approve tiene que haber escrito algo.
    expect(llamadas.length).toBeGreaterThan(0);

    for (const { name, args } of llamadas) {
      const rutas = DOS_RUTAS.has(name) ? [args[0], args[1]] : [args[0]];
      for (const r of rutas) {
        const rel = path.relative(approvals, path.resolve(String(r)));
        const fuera = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
        expect(fuera, `${name} escribio fuera de approvals: ${String(r)}`).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 10: Ejecutar toda la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commitear**

```bash
git add src/approvals/approve.ts src/cli/index.ts tests/approvals/approve.test.ts tests/cli/cli.test.ts tests/invariants/approve-boundary.test.ts
git commit -m "feat: hygiene approve por operacion; --risk se materializa en IDs concretos"
```

---

## Task 8: Hash en streaming y movimiento seguro

**Files:**
- Create: `src/executor/hash.ts`, `src/executor/move.ts`
- Test: `tests/executor/move.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashFile } from '../../src/executor/hash.js';
import { moveFile, MoveVerificationError } from '../../src/executor/move.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const existe = (p: string) => access(p).then(() => true, () => false);
const exdev = async (): Promise<void> => {
  throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
};

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'hyg-mv-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('hashFile', () => {
  it('coincide con el sha256 del contenido', async () => {
    const p = path.join(dir, 'a.txt');
    await writeFile(p, 'hola');
    expect(await hashFile(p)).toBe(sha('hola'));
  });
});

describe('moveFile', () => {
  it('mueve con rename en el mismo volumen', async () => {
    const from = path.join(dir, 'a.txt');
    const to = path.join(dir, 'b.txt');
    await writeFile(from, 'hola');
    await moveFile(from, to, sha('hola'));
    expect(await existe(from)).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('hola');
  });

  it('entre volumenes copia, verifica y solo entonces borra el origen', async () => {
    const from = path.join(dir, 'a.txt');
    const to = path.join(dir, 'b.txt');
    await writeFile(from, 'hola');
    await moveFile(from, to, sha('hola'), { rename: exdev });
    expect(await existe(from)).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('hola');
  });

  it('si la copia no verifica, deja el origen intacto y no deja copia', async () => {
    const from = path.join(dir, 'a.txt');
    const to = path.join(dir, 'b.txt');
    await writeFile(from, 'hola');
    await expect(moveFile(from, to, sha('otra cosa'), { rename: exdev }))
      .rejects.toBeInstanceOf(MoveVerificationError);
    expect(await readFile(from, 'utf8')).toBe('hola');
    expect(await existe(to)).toBe(false);
  });

  it('propaga cualquier otro error de rename sin tocar el origen', async () => {
    const from = path.join(dir, 'a.txt');
    await writeFile(from, 'hola');
    await expect(moveFile(from, path.join(dir, 'no', 'existe', 'b.txt'), sha('hola')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await existe(from)).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/executor/move.test.ts`
Expected: FAIL, no se pueden resolver `src/executor/hash.js` ni `src/executor/move.js`.

- [ ] **Step 3: Implementar `src/executor/hash.ts`**

```ts
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
```

- [ ] **Step 4: Implementar `src/executor/move.ts`**

```ts
import { constants, copyFile, rename, unlink } from 'node:fs/promises';
import { hashFile } from './hash.js';

export interface MoveDeps {
  rename(from: string, to: string): Promise<void>;
}

const DEFAULT_DEPS: MoveDeps = { rename };

export class MoveVerificationError extends Error {}

/**
 * Mueve un fichero. Intenta rename, que es atomico en el mismo volumen. Si
 * origen y destino estan en volumenes distintos (EXDEV), copia sin
 * sobrescribir, verifica el hash de la copia y solo entonces borra el origen.
 * Si la verificacion falla, borra la copia y deja el origen como estaba.
 */
export async function moveFile(
  from: string,
  to: string,
  expectedSha256: string,
  deps: MoveDeps = DEFAULT_DEPS,
): Promise<void> {
  try {
    await deps.rename(from, to);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
  }

  await copyFile(from, to, constants.COPYFILE_EXCL);
  const copied = await hashFile(to);
  if (copied !== expectedSha256) {
    await unlink(to);
    throw new MoveVerificationError(`la copia de ${from} no coincide con el hash esperado; el origen no se ha tocado`);
  }
  await unlink(from);
}
```

- [ ] **Step 5: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/executor/move.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commitear**

```bash
git add src/executor/hash.ts src/executor/move.ts tests/executor/move.test.ts
git commit -m "feat: movimiento de ficheros con respaldo verificado entre volumenes"
```

---

## Task 9: Permisos según plataforma

**Files:**
- Create: `src/executor/permissions.ts`
- Test: `tests/executor/permissions.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, chmod, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capturePermissions, applyPermissions } from '../../src/executor/permissions.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'hyg-perm-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('permisos', () => {
  it.runIf(process.platform !== 'win32')('captura y restaura el modo POSIX', async () => {
    const p = path.join(dir, 'a.log');
    await writeFile(p, 'x');
    await chmod(p, 0o640);

    const perms = await capturePermissions(p, dir);
    expect(perms).toMatchObject({ model: 'posix', captured: true, data: { mode: 0o640 } });

    await chmod(p, 0o600);
    expect(await applyPermissions(p, dir, perms)).toBe('restored');
    expect((await stat(p)).mode & 0o777).toBe(0o640);
  });

  it.runIf(process.platform === 'win32')('captura la ACL con icacls y la restaura', async () => {
    const p = path.join(dir, 'a.log');
    await writeFile(p, 'x');

    const perms = await capturePermissions(p, dir);
    expect(perms).toEqual({ model: 'acl', captured: true, data: { aclFile: 'acl.txt' } });
    expect(await access(path.join(dir, 'acl.txt')).then(() => true, () => false)).toBe(true);
    expect(await applyPermissions(p, dir, perms)).toBe('restored');
  });

  it('en una plataforma sin soporte no finge exito', async () => {
    const p = path.join(dir, 'a.log');
    await writeFile(p, 'x');
    const perms = await capturePermissions(p, dir, 'aix');
    expect(perms).toEqual({ model: 'none', captured: false, data: null });
    expect(await applyPermissions(p, dir, perms)).toBe('unsupported');
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/executor/permissions.test.ts`
Expected: FAIL, no se puede resolver `src/executor/permissions.js`.

- [ ] **Step 3: Implementar `src/executor/permissions.ts`**

```ts
import { chmod, chown, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

export type PermissionModel = 'posix' | 'acl' | 'none';

export interface CapturedPermissions {
  model: PermissionModel;
  /** false si la plataforma no lo permite o la captura fallo. Nunca se finge. */
  captured: boolean;
  data: { mode: number; uid: number; gid: number } | { aclFile: string } | null;
}

/** restored: todo; partial: el fichero volvio pero no todos sus metadatos. */
export type PermissionRestore = 'restored' | 'partial' | 'unsupported';

const ACL_FILE = 'acl.txt';

/**
 * Captura permisos antes de mover (spec §8). En Windows guarda la ACL con
 * `icacls /save` en la carpeta de la entrada; en Linux y macOS, modo y
 * propietario. execFile no pasa por shell.
 */
export async function capturePermissions(
  absPath: string,
  entryDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<CapturedPermissions> {
  if (platform === 'win32') {
    try {
      await run('icacls', [absPath, '/save', path.join(entryDir, ACL_FILE), '/q']);
      return { model: 'acl', captured: true, data: { aclFile: ACL_FILE } };
    } catch {
      return { model: 'acl', captured: false, data: null };
    }
  }
  if (platform === 'linux' || platform === 'darwin') {
    const s = await stat(absPath);
    return { model: 'posix', captured: true, data: { mode: s.mode & 0o7777, uid: s.uid, gid: s.gid } };
  }
  return { model: 'none', captured: false, data: null };
}

export async function applyPermissions(
  absPath: string,
  entryDir: string,
  perms: CapturedPermissions,
): Promise<PermissionRestore> {
  if (!perms.captured || !perms.data) return 'unsupported';

  if (perms.model === 'acl' && 'aclFile' in perms.data) {
    try {
      // icacls /restore aplica la ACL a los ficheros del directorio que
      // aparecen por nombre en el fichero guardado.
      await run('icacls', [path.dirname(absPath), '/restore', path.join(entryDir, perms.data.aclFile), '/q']);
      return 'restored';
    } catch {
      return 'partial';
    }
  }

  if (perms.model === 'posix' && 'mode' in perms.data) {
    await chmod(absPath, perms.data.mode);
    const s = await stat(absPath);
    if (s.uid === perms.data.uid && s.gid === perms.data.gid) return 'restored';
    try {
      await chown(absPath, perms.data.uid, perms.data.gid);
      return 'restored';
    } catch {
      return 'partial';
    }
  }

  return 'unsupported';
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/executor/permissions.test.ts`
Expected: PASS. En Windows, 2 tests (se omite el de POSIX); en Linux y macOS,
2 tests (se omite el de ACL). El de Windows también lo ejecuta la matriz de CI.

- [ ] **Step 5: Commitear**

```bash
git add src/executor/permissions.ts tests/executor/permissions.test.ts
git commit -m "feat: captura y restauracion de permisos por plataforma, unsupported sin fingir"
```

---

## Task 10: Manifiesto y entradas de cuarentena

**Files:**
- Create: `src/executor/manifest.ts`
- Test: `tests/executor/manifest.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  allocateEntry, findEntries, readManifest, writeManifest,
  InvalidEntryRefError, type Manifest,
} from '../../src/executor/manifest.js';

const DIA = new Date('2026-09-26T10:00:00.000Z');
let home: string;
beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), 'hyg-man-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

function manifiesto(extra: Partial<Manifest> = {}): Manifest {
  return {
    schema_version: 1, operation_id: 'OP-000001', entry: '2026-09-26/OP-000001',
    state: 'quarantined', created_at: DIA.toISOString(), restored_at: null,
    root: '/ws', relative_path: 'debug.log', source: '/ws/debug.log',
    quarantine_path: '/h/debug.log', sha256: 'abc', size: 1, platform: 'linux',
    permissions: { model: 'none', captured: false, data: null },
    rule_ids: ['FS-TEMP-001'], reason: 'r', restorable: true, restore_report: null,
    ...extra,
  };
}

async function crear(opId: string, state: Manifest['state'] = 'quarantined'): Promise<string> {
  const { entry, dir } = await allocateEntry(home, opId, DIA);
  await writeManifest(dir, manifiesto({ operation_id: opId, entry, state }));
  return entry;
}

describe('allocateEntry', () => {
  it('crea quarantine/<fecha>/<OP-ID>', async () => {
    const e = await allocateEntry(home, 'OP-000001', DIA);
    expect(e.entry).toBe('2026-09-26/OP-000001');
    expect(e.dir).toBe(path.join(home, 'quarantine', '2026-09-26', 'OP-000001'));
  });

  it('no pisa una entrada existente con el mismo OP-ID', async () => {
    await allocateEntry(home, 'OP-000001', DIA);
    expect((await allocateEntry(home, 'OP-000001', DIA)).entry).toBe('2026-09-26/OP-000001-2');
  });
});

describe('manifiesto', () => {
  it('se escribe y se lee sin dejar temporales', async () => {
    const { dir } = await allocateEntry(home, 'OP-000001', DIA);
    await writeManifest(dir, manifiesto());
    expect(await readManifest(dir)).toEqual(manifiesto());
    expect(await readdir(dir)).toEqual(['manifest.json']);
  });
});

describe('findEntries', () => {
  it('sin cuarentena devuelve una lista vacia', async () => {
    expect(await findEntries(home, 'OP-000001')).toEqual([]);
  });

  it('encuentra todas las entradas activas de un OP-ID', async () => {
    await crear('OP-000001');
    await crear('OP-000001');
    await crear('OP-000002');
    expect((await findEntries(home, 'OP-000001')).map((e) => e.entry))
      .toEqual(['2026-09-26/OP-000001', '2026-09-26/OP-000001-2']);
  });

  it('prefiere las entradas no restauradas', async () => {
    await crear('OP-000001', 'restored');
    await crear('OP-000001');
    expect((await findEntries(home, 'OP-000001')).map((e) => e.entry)).toEqual(['2026-09-26/OP-000001-2']);
  });

  it('si todas estan restauradas, las devuelve para poder decirlo', async () => {
    await crear('OP-000001', 'restored');
    expect((await findEntries(home, 'OP-000001')).map((e) => e.manifest.state)).toEqual(['restored']);
  });

  it('acepta una referencia exacta fecha/entrada', async () => {
    await crear('OP-000001');
    await crear('OP-000001');
    expect((await findEntries(home, '2026-09-26/OP-000001-2')).map((e) => e.entry))
      .toEqual(['2026-09-26/OP-000001-2']);
  });

  it('rechaza referencias que podrian salir de la cuarentena', async () => {
    await expect(findEntries(home, '../../etc')).rejects.toBeInstanceOf(InvalidEntryRefError);
    await expect(findEntries(home, '2026-09-26/../../x')).rejects.toBeInstanceOf(InvalidEntryRefError);
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/executor/manifest.test.ts`
Expected: FAIL, no se puede resolver `src/executor/manifest.js`.

- [ ] **Step 3: Implementar `src/executor/manifest.ts`**

```ts
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CapturedPermissions, PermissionRestore } from './permissions.js';

export type ManifestState = 'pending' | 'quarantined' | 'restored';

/** Formato de la spec §8, mas estado y datos de restauracion. */
export interface Manifest {
  schema_version: 1;
  operation_id: string;
  entry: string;
  state: ManifestState;
  created_at: string;
  restored_at: string | null;
  root: string;
  relative_path: string;
  source: string;
  quarantine_path: string;
  sha256: string;
  size: number;
  platform: NodeJS.Platform;
  permissions: CapturedPermissions;
  rule_ids: string[];
  reason: string;
  restorable: boolean;
  restore_report: { permissions: PermissionRestore } | null;
}

export interface QuarantineEntry {
  entry: string;
  dir: string;
  manifest: Manifest;
}

export class InvalidEntryRefError extends Error {}

const MANIFEST = 'manifest.json';
const OP_REF = /^OP-\d{6}$/;
// Formato cerrado: impide que una referencia con '..' salga de la cuarentena.
const ENTRY_REF = /^\d{4}-\d{2}-\d{2}\/OP-\d{6}(-\d+)?$/;

export function quarantineDir(home: string): string {
  return path.join(home, 'quarantine');
}

/** Crea quarantine/<AAAA-MM-DD>/<OP-ID>, o <OP-ID>-2, -3... si ya existe. */
export async function allocateEntry(home: string, opId: string, now: Date): Promise<{ entry: string; dir: string }> {
  const day = now.toISOString().slice(0, 10);
  const dayDir = path.join(quarantineDir(home), day);
  await mkdir(dayDir, { recursive: true });
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? opId : `${opId}-${n}`;
    const dir = path.join(dayDir, name);
    try {
      await mkdir(dir);
      return { entry: `${day}/${name}`, dir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

/** Escritura atomica: temporal y rename. */
export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  const file = path.join(dir, MANIFEST);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

export async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8')) as Manifest;
}

async function listDir(p: string): Promise<string[]> {
  try {
    return (await readdir(p)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Busca por referencia exacta AAAA-MM-DD/OP-000123[-n] o por OP-ID. Con OP-ID
 * devuelve las entradas no restauradas; si todas lo estan, las devuelve igual
 * para que restore pueda decir que ya se restauraron.
 */
export async function findEntries(home: string, ref: string): Promise<QuarantineEntry[]> {
  if (ENTRY_REF.test(ref)) {
    const dir = path.join(quarantineDir(home), ...ref.split('/'));
    try {
      return [{ entry: ref, dir, manifest: await readManifest(dir) }];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
  if (!OP_REF.test(ref)) {
    throw new InvalidEntryRefError(`referencia no valida: ${ref}. Usa OP-000123 o AAAA-MM-DD/OP-000123`);
  }

  const found: QuarantineEntry[] = [];
  for (const day of await listDir(quarantineDir(home))) {
    for (const name of await listDir(path.join(quarantineDir(home), day))) {
      if (name !== ref && !name.startsWith(`${ref}-`)) continue;
      const dir = path.join(quarantineDir(home), day, name);
      const manifest = await readManifest(dir);
      if (manifest.operation_id === ref) found.push({ entry: `${day}/${name}`, dir, manifest });
    }
  }
  const active = found.filter((e) => e.manifest.state !== 'restored');
  return active.length > 0 ? active : found;
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/executor/manifest.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commitear**

```bash
git add src/executor/manifest.ts tests/executor/manifest.test.ts
git commit -m "feat: manifiesto de cuarentena con escritura atomica y busqueda por OP-ID"
```

---

## Task 11: Cuarentena de una operación

**Files:**
- Create: `src/executor/quarantine.ts`
- Test: `tests/executor/quarantine.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Operation } from '../../src/core/types.js';
import { quarantineOne } from '../../src/executor/quarantine.js';
import { readManifest } from '../../src/executor/manifest.js';
import { HomeInsideWorkspaceError } from '../../src/core/home.js';

const DIA = new Date('2026-09-26T10:00:00.000Z');
const existe = (p: string) => access(p).then(() => true, () => false);

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-q-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function opPara(rel: string, id = 'OP-000001'): Promise<Operation> {
  const buf = await readFile(path.join(root, rel));
  return {
    id, type: 'quarantine', path: rel, findingIds: ['F-000001'], ruleIds: ['FS-TEMP-001'],
    risk: 'safe', reason: 'Fichero de log abandonado', degradedFrom: null, degradeReason: null,
    source: { sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length },
  };
}

describe('quarantineOne', () => {
  it('mueve el fichero a la cuarentena y deja un manifiesto completo', async () => {
    await writeFile(path.join(root, 'debug.log'), 'log');
    const op = await opPara('debug.log');

    const r = await quarantineOne({ root, home, op, now: DIA });
    expect(r).toEqual({ status: 'quarantined', opId: 'OP-000001', path: 'debug.log', entry: '2026-09-26/OP-000001' });
    expect(await existe(path.join(root, 'debug.log'))).toBe(false);

    const m = await readManifest(path.join(home, 'quarantine', '2026-09-26', 'OP-000001'));
    expect(m).toMatchObject({
      state: 'quarantined', operation_id: 'OP-000001', relative_path: 'debug.log',
      source: path.join(root, 'debug.log'), sha256: op.source.sha256, size: 3,
      rule_ids: ['FS-TEMP-001'], restorable: true, restored_at: null,
    });
    expect(await readFile(m.quarantine_path, 'utf8')).toBe('log');
  });

  it('omite la operacion si el contenido cambio desde la aprobacion', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'aaa');
    const op = await opPara('debug.log');
    await writeFile(p, 'bbb');

    const r = await quarantineOne({ root, home, op });
    expect(r).toMatchObject({ status: 'skipped', reason: expect.stringContaining('contenido') });
    expect(await readFile(p, 'utf8')).toBe('bbb');
    expect(await existe(path.join(home, 'quarantine'))).toBe(false);
  });

  it('omite la operacion si el origen ya no existe', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    const op = await opPara('debug.log');
    await rm(path.join(root, 'debug.log'));
    expect(await quarantineOne({ root, home, op })).toMatchObject({ status: 'skipped' });
  });

  it('se niega a operar si la base cae dentro del workspace', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'x');
    const op = await opPara('debug.log');
    await expect(quarantineOne({ root, home: path.join(root, '.hygiene'), op }))
      .rejects.toBeInstanceOf(HomeInsideWorkspaceError);
    expect(await existe(p)).toBe(true);
  });

  it('si el movimiento falla, el origen sigue en su sitio y la entrada queda pending', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'x');
    const op = await opPara('debug.log');
    const falla = async (): Promise<void> => {
      throw Object.assign(new Error('bloqueado'), { code: 'EBUSY' });
    };

    const r = await quarantineOne({ root, home, op, now: DIA, moveDeps: { rename: falla } });
    expect(r).toMatchObject({ status: 'failed', reason: 'bloqueado' });
    expect(await existe(p)).toBe(true);
    const m = await readManifest(path.join(home, 'quarantine', '2026-09-26', 'OP-000001'));
    expect(m.state).toBe('pending');
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/executor/quarantine.test.ts`
Expected: FAIL, no se puede resolver `src/executor/quarantine.js`.

- [ ] **Step 3: Implementar `src/executor/quarantine.ts`**

```ts
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Operation } from '../core/types.js';
import { assertHomeOutside } from '../core/home.js';
import { hashFile } from './hash.js';
import { moveFile, type MoveDeps } from './move.js';
import { capturePermissions } from './permissions.js';
import { allocateEntry, writeManifest, type Manifest } from './manifest.js';

export interface QuarantineRequest {
  root: string;
  home: string;
  op: Operation;
  now?: Date;
  moveDeps?: MoveDeps;
}

export type QuarantineOutcome =
  | { status: 'quarantined'; opId: string; path: string; entry: string }
  | { status: 'skipped'; opId: string; path: string; reason: string }
  | { status: 'failed'; opId: string; path: string; reason: string };

/**
 * CLEAN -> MOVE -> QUARANTINE -> MANIFEST (spec §8), con dos refuerzos: el
 * origen se revalida contra la huella aprobada justo antes de mover, y el
 * manifiesto se escribe en estado pending antes del movimiento para que un
 * corte a mitad deje una entrada recuperable.
 */
export async function quarantineOne(req: QuarantineRequest): Promise<QuarantineOutcome> {
  const { op } = req;
  const base = { opId: op.id, path: op.path };

  if (op.type !== 'quarantine') return { status: 'skipped', ...base, reason: `tipo ${op.type} no ejecutable` };
  const expected = op.source.sha256;
  if (!expected) return { status: 'skipped', ...base, reason: 'la operacion no tiene huella de origen' };

  await assertHomeOutside(req.home, req.root);
  const source = path.join(req.root, op.path);

  let st;
  try {
    st = await lstat(source);
  } catch {
    return { status: 'skipped', ...base, reason: 'el origen ya no existe' };
  }
  if (!st.isFile()) return { status: 'skipped', ...base, reason: 'el origen ya no es un fichero regular' };
  if (st.size !== op.source.size) {
    return { status: 'skipped', ...base, reason: 'el tamano del origen ha cambiado desde la aprobacion' };
  }
  if (await hashFile(source) !== expected) {
    return { status: 'skipped', ...base, reason: 'el contenido del origen ha cambiado desde la aprobacion' };
  }

  const now = req.now ?? new Date();
  const { entry, dir } = await allocateEntry(req.home, op.id, now);
  const payloadDir = path.join(dir, 'payload');
  await mkdir(payloadDir);
  const target = path.join(payloadDir, path.basename(source));

  const manifest: Manifest = {
    schema_version: 1,
    operation_id: op.id,
    entry,
    state: 'pending',
    created_at: now.toISOString(),
    restored_at: null,
    root: req.root,
    relative_path: op.path,
    source,
    quarantine_path: target,
    sha256: expected,
    size: st.size,
    platform: process.platform,
    permissions: await capturePermissions(source, dir),
    rule_ids: op.ruleIds,
    reason: op.reason,
    restorable: true,
    restore_report: null,
  };
  await writeManifest(dir, manifest);

  try {
    await moveFile(source, target, expected, req.moveDeps);
    if (await hashFile(target) !== expected) {
      return { status: 'failed', ...base, reason: `el payload de ${entry} no coincide con el hash; revisa la entrada antes de restaurar` };
    }
  } catch (err) {
    return { status: 'failed', ...base, reason: err instanceof Error ? err.message : String(err) };
  }

  await writeManifest(dir, { ...manifest, state: 'quarantined' });
  return { status: 'quarantined', ...base, entry };
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/executor/quarantine.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commitear**

```bash
git add src/executor/quarantine.ts tests/executor/quarantine.test.ts
git commit -m "feat: cuarentena de una operacion con revalidacion de huella y manifiesto previo"
```

---

## Task 12: Restore

**Files:**
- Create: `src/executor/restore.ts`
- Test: `tests/executor/restore.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Operation } from '../../src/core/types.js';
import { quarantineOne } from '../../src/executor/quarantine.js';
import { findEntries, readManifest, writeManifest, type QuarantineEntry } from '../../src/executor/manifest.js';
import { restoreEntry } from '../../src/executor/restore.js';

const DIA = new Date('2026-09-26T10:00:00.000Z');
const existe = (p: string) => access(p).then(() => true, () => false);

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-rs-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function enCuarentena(rel: string, contenido: string): Promise<QuarantineEntry> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contenido);
  const buf = await readFile(abs);
  const op: Operation = {
    id: 'OP-000001', type: 'quarantine', path: rel, findingIds: ['F-000001'], ruleIds: ['FS-TEMP-001'],
    risk: 'safe', reason: 'r', degradedFrom: null, degradeReason: null,
    source: { sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length },
  };
  const r = await quarantineOne({ root, home, op, now: DIA });
  if (r.status !== 'quarantined') throw new Error(`preparacion fallida: ${r.status}`);
  const [e] = await findEntries(home, 'OP-000001');
  return e!;
}

describe('restoreEntry', () => {
  it('devuelve el fichero a su ruta con el mismo hash y marca la entrada', async () => {
    const e = await enCuarentena('debug.log', 'log');
    const r = await restoreEntry(e, DIA);
    expect(r).toMatchObject({ status: 'restored', source: path.join(root, 'debug.log') });
    expect(await readFile(path.join(root, 'debug.log'), 'utf8')).toBe('log');

    const m = await readManifest(e.dir);
    expect(m.state).toBe('restored');
    expect(m.restored_at).toBe(DIA.toISOString());
    expect(m.restore_report).not.toBeNull();
  });

  it('recrea el directorio padre si ya no existe', async () => {
    const e = await enCuarentena('logs/viejo.log', 'x');
    await rm(path.join(root, 'logs'), { recursive: true });
    expect((await restoreEntry(e)).status).toBe('restored');
    expect(await readFile(path.join(root, 'logs', 'viejo.log'), 'utf8')).toBe('x');
  });

  it('aborta sin tocar el workspace si el payload fue alterado', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await writeFile(e.manifest.quarantine_path, 'manipulado');

    const r = await restoreEntry(e);
    expect(r).toMatchObject({ status: 'aborted', reason: expect.stringContaining('hash') });
    expect(await existe(path.join(root, 'debug.log'))).toBe(false);
    expect(await readFile(e.manifest.quarantine_path, 'utf8')).toBe('manipulado');
  });

  it('no sobrescribe un fichero que ya ocupa la ruta', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await writeFile(path.join(root, 'debug.log'), 'nuevo');
    expect((await restoreEntry(e)).status).toBe('aborted');
    expect(await readFile(path.join(root, 'debug.log'), 'utf8')).toBe('nuevo');
  });

  it('una entrada ya restaurada no se restaura dos veces', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await restoreEntry(e);
    const [otra] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(otra!)).toMatchObject({ status: 'aborted', reason: expect.stringContaining('ya se restauro') });
  });

  it('una entrada pending sin payload explica que el origen no se llego a mover', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await writeManifest(e.dir, { ...e.manifest, state: 'pending' });
    await rm(e.manifest.quarantine_path);
    const [pendiente] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(pendiente!)).toMatchObject({ status: 'aborted', reason: expect.stringContaining('no llego a moverse') });
  });
});
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/executor/restore.test.ts`
Expected: FAIL, no se puede resolver `src/executor/restore.js`.

- [ ] **Step 3: Implementar `src/executor/restore.ts`**

```ts
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hashFile } from './hash.js';
import { moveFile } from './move.js';
import { applyPermissions, type PermissionRestore } from './permissions.js';
import { writeManifest, type QuarantineEntry } from './manifest.js';

export type RestoreOutcome =
  | { status: 'restored'; entry: string; source: string; permissions: PermissionRestore }
  | { status: 'aborted'; entry: string; reason: string };

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * RESTORE -> VERIFY HASH -> RETURN (spec §8). Si el hash no coincide, o la
 * ruta original ya esta ocupada, aborta sin tocar el workspace.
 */
export async function restoreEntry(e: QuarantineEntry, now: Date = new Date()): Promise<RestoreOutcome> {
  const m = e.manifest;
  const abort = (reason: string): RestoreOutcome => ({ status: 'aborted', entry: e.entry, reason });

  if (m.state === 'restored') return abort('la entrada ya se restauro');
  if (!m.restorable) return abort('la entrada esta marcada como no restaurable');
  if (!(await exists(m.quarantine_path))) {
    return abort(m.state === 'pending'
      ? 'la operacion no llego a moverse: el origen deberia seguir en su sitio'
      : 'falta el payload de la entrada');
  }
  if (await hashFile(m.quarantine_path) !== m.sha256) {
    return abort('el hash del payload no coincide con el manifiesto');
  }
  // Existe una ventana entre esta comprobacion y el rename; rename en POSIX
  // sobrescribiria. Aceptado: el executor es de un solo usuario y esta
  // comprobacion cubre el caso real (el fichero se recreo despues del clean).
  if (await exists(m.source)) return abort(`ya existe un fichero en ${m.source}; no se sobrescribe`);

  await mkdir(path.dirname(m.source), { recursive: true });
  await moveFile(m.quarantine_path, m.source, m.sha256);
  if (await hashFile(m.source) !== m.sha256) {
    throw new Error(`el fichero restaurado en ${m.source} no coincide con el hash del manifiesto`);
  }

  const permissions = await applyPermissions(m.source, e.dir, m.permissions);
  await writeManifest(e.dir, {
    ...m,
    state: 'restored',
    restored_at: now.toISOString(),
    restore_report: { permissions },
  });
  return { status: 'restored', entry: e.entry, source: m.source, permissions };
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/executor/restore.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commitear**

```bash
git add src/executor/restore.ts tests/executor/restore.test.ts
git commit -m "feat: restore verifica el hash, no sobrescribe y marca la entrada como restaurada"
```

---

## Task 13: `runClean` y comando `clean --approved`

**Files:**
- Create: `src/clean.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/clean.test.ts`, `tests/cli/cli.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

`tests/clean.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runClean } from '../src/clean.js';
import { runPlan } from '../src/plan.js';
import { selectOperations, mergeApproval } from '../src/approvals/approve.js';
import { loadApprovals, saveApprovals } from '../src/approvals/store.js';

const RULES = path.join(process.cwd(), 'rules');
const existe = (p: string) => access(p).then(() => true, () => false);

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-cl-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

// Contenidos distintos: dos logs iguales dispararian FS-DUP-001 y el
// conflicto de sugerencias los degradaria a review.
async function logViejo(rel: string, contenido: string): Promise<void> {
  const p = path.join(root, rel);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}

async function aprobarTodo(): Promise<void> {
  const { plan } = await runPlan({ root, rulesDir: RULES });
  const { selected } = selectOperations({ plan, ids: [], risk: 'high' });
  await saveApprovals(home, mergeApproval(null, plan, selected, ['--risk', 'high'], new Date()));
}

describe('runClean', () => {
  it('sin aprobaciones no hace nada', async () => {
    await logViejo('debug.log', 'a');
    expect(await runClean({ root, rulesDir: RULES, home })).toEqual({ status: 'no-approvals' });
    expect(await existe(path.join(root, 'debug.log'))).toBe(true);
  });

  it('ejecuta lo aprobado y consume la aprobacion', async () => {
    await logViejo('debug.log', 'a');
    await aprobarTodo();

    const r = await runClean({ root, rulesDir: RULES, home });
    expect(r.status).toBe('executed');
    if (r.status !== 'executed') return;
    expect(r.outcomes.map((o) => o.status)).toEqual(['quarantined']);
    expect(await existe(path.join(root, 'debug.log'))).toBe(false);
    expect(await loadApprovals(home, root)).toBeNull();
  });

  it('una aprobacion que ya no coincide con el disco bloquea todo', async () => {
    await logViejo('a.log', 'a');
    await logViejo('b.log', 'b');
    await aprobarTodo();
    await logViejo('b.log', 'b cambiado');

    const r = await runClean({ root, rulesDir: RULES, home });
    expect(r.status).toBe('stale');
    if (r.status !== 'stale') return;
    expect(r.stale.map((a) => a.path)).toEqual(['b.log']);
    expect(await existe(path.join(root, 'a.log'))).toBe(true);
    expect(await existe(path.join(root, 'b.log'))).toBe(true);
    expect(await loadApprovals(home, root)).not.toBeNull();
  });
});
```

Añadir dentro del `describe('main', ...)` de `tests/cli/cli.test.ts`:

```ts
  it('clean sin --approved se niega y no modifica nada', async () => {
    await logViejo('debug.log');
    expect(await main(['clean', '--root', root], print)).toBe(2);
    expect(salida.join('\n')).toContain('ERROR: No approved operations. Nothing was modified.');
    expect(await readdir(root)).toEqual(['debug.log']);
  });

  it('clean --approved sin aprobaciones devuelve 2', async () => {
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(2);
    expect(salida.join('\n')).toContain('No approved operations');
  });
```

- [ ] **Step 2: Ejecutarlos y ver que fallan**

Run: `npx vitest run tests/clean.test.ts tests/cli/cli.test.ts`
Expected: FAIL, no se puede resolver `src/clean.js`, y `clean` es un comando desconocido.

- [ ] **Step 3: Implementar `src/clean.ts`**

```ts
import type { Operation } from './core/types.js';
import type { Limits } from './core/limits.js';
import { assertHomeOutside } from './core/home.js';
import { runPlan } from './plan.js';
import {
  approvalKey, deleteApprovals, loadApprovals, type ApprovedOperation,
} from './approvals/store.js';
import { quarantineOne, type QuarantineOutcome } from './executor/quarantine.js';

export interface CleanOptions {
  root: string;
  rulesDir: string;
  home: string;
  limits?: Partial<Limits>;
  now?: Date;
}

export type CleanResult =
  | { status: 'no-approvals' }
  | { status: 'stale'; stale: ApprovedOperation[] }
  | { status: 'executed'; outcomes: QuarantineOutcome[] };

/** Barrera final (spec §9): solo se ejecuta lo registrado como aprobado. */
export async function runClean(o: CleanOptions): Promise<CleanResult> {
  const approvals = await loadApprovals(o.home, o.root);
  if (!approvals || approvals.operations.length === 0) return { status: 'no-approvals' };
  await assertHomeOutside(o.home, o.root);

  // Una aprobacion caduca si el plan que la origino ya no coincide con el
  // disco: cada operacion aprobada tiene que seguir en el plan recalculado
  // ahora, con el mismo tipo, ruta y hash. Si falta una, no se mueve nada.
  const { plan } = await runPlan({ root: o.root, rulesDir: o.rulesDir, limits: o.limits });
  const current = new Map(plan.operations.map((op) => [
    approvalKey({ type: op.type, path: op.path, sha256: op.source.sha256 }), op,
  ]));

  const matched: Operation[] = [];
  const stale: ApprovedOperation[] = [];
  for (const a of approvals.operations) {
    const op = current.get(approvalKey(a));
    // Se conserva el OP-ID que el usuario aprobo: es el que vera en restore.
    if (op) matched.push({ ...op, id: a.id });
    else stale.push(a);
  }
  if (stale.length > 0) return { status: 'stale', stale };

  const outcomes: QuarantineOutcome[] = [];
  for (const op of matched) {
    try {
      outcomes.push(await quarantineOne({ root: o.root, home: o.home, op, now: o.now }));
    } catch (err) {
      outcomes.push({
        status: 'failed', opId: op.id, path: op.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Una aprobacion vale para una sola ejecucion.
  await deleteApprovals(o.home, o.root);
  return { status: 'executed', outcomes };
}
```

- [ ] **Step 4: Añadir `clean` a `src/cli/index.ts`**

Añadir la importación `import { runClean } from '../clean.js';` y la opción
`approved: { type: 'boolean' },` al objeto `options` de `parseArgs`.

En `USAGE`, añadir tras la línea de `approve`:

```
  clean --approved       Mueve a cuarentena solo lo aprobado
```

y tras la línea de `--reset` de `Opciones`:

```
  --approved             clean: confirma que solo se ejecuta lo aprobado
```

Añadir este bloque justo después del bloque de `approve`:

```ts
    if (command === 'clean') {
      if (parsed.values.approved !== true) {
        print('ERROR: No approved operations. Nothing was modified.');
        print('clean solo ejecuta lo aprobado: hygiene clean --approved [--root <ruta>]');
        return 2;
      }
      const root = await resolveDir(parsed.values.root, print);
      if (!root) return 2;

      const result = await runClean({ root, rulesDir: RULES_DIR, home: resolveHome() });
      if (result.status === 'no-approvals') {
        print('ERROR: No approved operations. Nothing was modified.');
        return 2;
      }
      if (result.status === 'stale') {
        print('ERROR: las aprobaciones ya no coinciden con el disco. Nothing was modified.');
        for (const a of result.stale) print(`  caducada  ${a.id}  ${a.type}  ${a.path}`);
        print('Vuelve a ejecutar hygiene plan y aprueba de nuevo, o descarta con hygiene approve --reset.');
        return 2;
      }

      let failed = 0;
      for (const o of result.outcomes) {
        if (o.status === 'quarantined') {
          print(`  cuarentena  ${o.opId}  ${o.path}  -> ${o.entry}`);
        } else {
          if (o.status === 'failed') failed += 1;
          print(`  ${o.status === 'failed' ? 'fallo' : 'omitida'}  ${o.opId}  ${o.path}  (${o.reason})`);
        }
      }
      print('Para deshacer: hygiene restore <OP-ID>');
      return failed > 0 ? 2 : 0;
    }
```

- [ ] **Step 5: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/clean.test.ts tests/cli/cli.test.ts`
Expected: PASS.

- [ ] **Step 6: Commitear**

```bash
git add src/clean.ts src/cli/index.ts tests/clean.test.ts tests/cli/cli.test.ts
git commit -m "feat: hygiene clean --approved con caducidad de aprobaciones todo o nada"
```

---

## Task 14: Comando `restore`

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir dentro del `describe('main', ...)` de `tests/cli/cli.test.ts`:

```ts
  it('restore sin referencia devuelve 2', async () => {
    expect(await main(['restore'], print)).toBe(2);
  });

  it('restore de una operacion inexistente devuelve 2', async () => {
    expect(await main(['restore', 'OP-000999'], print)).toBe(2);
    expect(salida.join('\n')).toContain('No hay ninguna entrada de cuarentena');
  });

  it('restore rechaza referencias mal formadas', async () => {
    expect(await main(['restore', '../../etc'], print)).toBe(2);
  });
```

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: FAIL. `restore` es un comando desconocido y devuelve 2, pero no
imprime "No hay ninguna entrada de cuarentena".

- [ ] **Step 2: Añadir `restore` a `src/cli/index.ts`**

Añadir las importaciones:

```ts
import { findEntries } from '../executor/manifest.js';
import { restoreEntry } from '../executor/restore.js';
```

En `USAGE`, añadir tras la línea de `clean`:

```
  restore <OP-ID>        Devuelve un fichero de la cuarentena verificando su hash
```

Añadir este bloque justo después del bloque de `clean`:

```ts
    if (command === 'restore') {
      if (!target) {
        print('Falta la operacion: hygiene restore <OP-ID|AAAA-MM-DD/OP-ID>');
        return 2;
      }
      const entries = await findEntries(resolveHome(), target);
      if (entries.length === 0) {
        print(`No hay ninguna entrada de cuarentena para ${target}.`);
        return 2;
      }
      if (entries.length > 1) {
        print(`${target} es ambiguo; hay varias entradas:`);
        for (const e of entries) print(`  ${e.entry}  ${e.manifest.state}  ${e.manifest.source}`);
        print('Indica la entrada concreta: hygiene restore <AAAA-MM-DD/OP-ID>');
        return 2;
      }

      const outcome = await restoreEntry(entries[0]!);
      if (outcome.status === 'aborted') {
        print(`ERROR: ${outcome.reason}. Nothing was modified.`);
        return 2;
      }
      print(`Restaurado: ${outcome.source}`);
      print(`Hash verificado. Permisos: ${outcome.permissions}`);
      return 0;
    }
```

Una referencia mal formada lanza `InvalidEntryRefError`, que el `catch` general
de `main` ya convierte en `Error: ...` y código 2.

- [ ] **Step 3: Ejecutar los tests y verlos pasar**

Run: `npx vitest run tests/cli/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commitear**

```bash
git add src/cli/index.ts tests/cli/cli.test.ts
git commit -m "feat: hygiene restore por OP-ID o por entrada exacta"
```

---

## Task 15: Ida y vuelta completa por la CLI

El test de la §15 de la spec: se llena un árbol, se pone en cuarentena, se
restaura y se verifican hash, ruta y metadatos según plataforma. Pasa por
`main`, igual que lo usaría una persona.

**Files:**
- Test: `tests/e2e/round-trip.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, chmod, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';
import { findEntries } from '../../src/executor/manifest.js';

const posix = process.platform !== 'win32';
const existe = (p: string) => access(p).then(() => true, () => false);
const sha = async (p: string) => createHash('sha256').update(await readFile(p)).digest('hex');

let base: string;
let root: string;
let home: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };
const homePrevio = process.env.HYGIENE_HOME;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-e2e-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
  process.env.HYGIENE_HOME = home;
  salida = [];
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  if (homePrevio === undefined) delete process.env.HYGIENE_HOME;
  else process.env.HYGIENE_HOME = homePrevio;
});

async function logViejo(rel: string, contenido: string): Promise<string> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(abs, viejo, viejo);
  return abs;
}

describe('ida y vuelta completa por la CLI', () => {
  it('plan, approve, clean y restore devuelven cada fichero con hash, ruta y permisos', async () => {
    const a = await logViejo('debug.log', 'primer log');
    const b = await logViejo('logs/servidor.log', 'segundo log');
    if (posix) await chmod(b, 0o640);
    const antes = { a: await sha(a), b: await sha(b) };

    await main(['plan', root, '--json'], print);
    const plan = JSON.parse(salida.join('\n')) as { operations: { id: string; type: string; path: string }[] };
    const cuarentenas = plan.operations.filter((o) => o.type === 'quarantine');
    expect(cuarentenas.map((o) => o.path)).toEqual(['debug.log', 'logs/servidor.log']);

    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(0);
    expect(await existe(a)).toBe(false);
    expect(await existe(b)).toBe(false);

    for (const op of cuarentenas) {
      expect(await main(['restore', op.id], print)).toBe(0);
    }
    expect(await sha(a)).toBe(antes.a);
    expect(await sha(b)).toBe(antes.b);
    if (posix) expect((await stat(b)).mode & 0o777).toBe(0o640);
    expect(salida.join('\n')).not.toContain('Permisos: unsupported');

    // La aprobacion se consumio: un segundo clean no tiene nada que hacer.
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(2);
  });

  it('clean aborta entero si un fichero aprobado cambio despues', async () => {
    const a = await logViejo('debug.log', 'uno');
    const b = await logViejo('otro.log', 'dos');
    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    await writeFile(b, 'dos, pero cambiado');

    expect(await main(['clean', '--approved', '--root', root], print)).toBe(2);
    expect(salida.join('\n')).toContain('Nothing was modified');
    expect(await existe(a)).toBe(true);
    expect(await existe(b)).toBe(true);
  });

  it('restore aborta si el payload fue manipulado y no toca el workspace', async () => {
    const a = await logViejo('debug.log', 'uno');
    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(0);

    const [entrada] = await findEntries(home, 'OP-000001');
    await writeFile(entrada!.manifest.quarantine_path, 'manipulado');

    expect(await main(['restore', 'OP-000001'], print)).toBe(2);
    expect(salida.join('\n')).toContain('hash');
    expect(await existe(a)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutarlo**

Run: `npx vitest run tests/e2e/round-trip.test.ts`
Expected: PASS, 3 tests. Si falla, no se toca el test: se diagnostica con
superpowers:systematic-debugging, porque este es el contrato de reversibilidad
de la DoD (§18).

- [ ] **Step 3: Commitear**

```bash
git add tests/e2e/round-trip.test.ts
git commit -m "test: ida y vuelta completa plan-approve-clean-restore por la CLI"
```

---

## Task 16: README, verificación final y autoauditoría

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Actualizar el aviso de cabecera del README**

Sustituir el bloque de cita que empieza por
`> **Hoy, project-hygiene solo diagnostica: no borra ni modifica nada.**` por:

```markdown
> **project-hygiene nunca modifica nada sin una aprobación explícita por
> operación.** `scan`, `audit`, `plan` y `explain` son de solo lectura por
> contrato (hay un test que falla si alguna vez escriben en disco). `clean`
> solo mueve a una cuarentena fuera del workspace lo que se aprobó antes con
> `approve`, y `restore` lo devuelve verificando el hash.
```

- [ ] **Step 2: Añadir el flujo de limpieza a la sección "Uso"**

Añadir al final de la sección `## Uso`, antes de `## Qué audita hoy`:

````markdown
### Limpiar con aprobación

```bash
node dist/cli/index.js plan .
node dist/cli/index.js approve OP-000001 OP-000002 --root .
node dist/cli/index.js approve --risk safe --root .
node dist/cli/index.js clean --approved --root .
node dist/cli/index.js restore OP-000001
```

`plan` muestra las operaciones propuestas, cada una con su ID, y no toca nada.
`approve` registra aprobaciones en `~/.hygiene/approvals/`. `--risk safe` es un
atajo que se guarda como la lista concreta de IDs a la que se expande. `clean
--approved` recalcula el plan: si una sola operación aprobada ya no coincide con
el disco, no mueve nada. Si todas coinciden, las mueve a
`~/.hygiene/quarantine/` con un manifiesto por operación. `restore` devuelve el
fichero a su ruta, se niega si el hash no coincide o si la ruta ya está ocupada,
y restaura permisos según la plataforma. Donde no puede, lo dice (`unsupported`)
en lugar de fingir que lo hizo.

La base `~/.hygiene` se cambia con la variable `HYGIENE_HOME`. Nunca puede caer
dentro del workspace auditado.

En esta versión solo se ejecutan operaciones `quarantine`, y solo sobre ficheros
regulares que nada referencia. Todo lo demás se propone como `review`.
````

- [ ] **Step 3: Actualizar la sección "Estado"**

Sustituir el contenido de `## Estado` hasta antes de `## Reglas disponibles` por:

```markdown
## Estado

Segunda de tres entregas planeadas.

**Primera entrega (núcleo de solo lectura):** detección de proyectos, los tres
collectors, motor de reglas con límites de ejecución, scorer, los cuatro packs
de reglas y los comandos `scan`, `audit` y `explain`.

**Segunda entrega (cuarentena reversible):** planner, aprobación por operación,
executor, cuarentena fuera del workspace con manifiesto, `restore` con
verificación de hash y permisos por plataforma, y los comandos `plan`,
`approve`, `clean --approved` y `restore`.

Lo que **no** incluye todavía:

- **`init`, `loop` y plantillas para nuevos proyectos.** Tercera entrega.
- **Ejecución de `ignore`, `move` y `create`.** Se proponen pero no se aprueban
  hasta que llegue `init`.
- **Reglas de nivel proyecto y workspace** (`FS-ROOT-001`, `GIT-NOREPO-001`,
  `AI-DOC-001` y otras). Necesitan un evaluador de ámbito de proyecto.
- **El predicado `in_git_history`** y con él `SEC-HIST-001`.
```

- [ ] **Step 4: Verificación completa**

Run: `npm run typecheck && npm test && npm run build && npm run dogfood`
Expected: los cuatro en verde. `npm run dogfood` sigue en 100/100 sobre `src` y
`rules` (NN-5). Si el dogfood encuentra algo en un fichero nuevo de `src/`, se
corrige el fichero, no se añade ninguna exclusión.

- [ ] **Step 5: Prueba manual contra un árbol real**

```bash
node dist/cli/index.js plan examples/before
```

Expected: imprime operaciones con ID y termina con "Este comando no ha
modificado nada.". `git status` sigue limpio después.

- [ ] **Step 6: Commitear**

```bash
git add README.md
git commit -m "docs: README con el flujo plan-approve-clean-restore y estado de la segunda entrega"
```

---

## Autorrevisión del plan

**Cobertura de la especificación.**

| Sección | Tareas |
|---|---|
| §3 contrato de efectos: `plan` read-only | 5 (test de invariante con intercepción de fs) |
| §3 contrato de efectos: `approve` solo en `approvals/` | 6, 7 (test de frontera con intercepción de fs) |
| §3 contrato de efectos: `clean` y `restore` modifican | 11, 12, 13, 14 |
| §6 degradación por confianza | 4 |
| §6 nunca `quarantine` si referenciado o indeterminado | 3, 4 |
| §6 `unknown` produce solo `review` | 4 (riesgo `unknown` y frontera `unknown-boundary`) |
| §6 ID estable `OP-000123` | 4 (determinismo con entrada desordenada) |
| §2 sin operaciones sobre fronteras desconocidas | 4 |
| §7 `FS-GENERATED-001` nunca a cuarentena | 4 (directorios y entradas no recorridas se degradan) |
| §8 cuarentena fuera del workspace, ruta configurable | 2, 6, 11 |
| §8 formato del manifiesto | 10, 11 |
| §8 restore verifica hash y aborta sin tocar nada | 12, 15 |
| §8 permisos POSIX, ACL, `unsupported` sin fingir | 9, 15 |
| §9 aprobación por operación, `--risk` como atajo materializado | 7 |
| §9 `clean` sin `--approved` es error | 13 |
| §9 caducidad y revalidación de hash y ruta | 11, 13, 15 |
| §15 ida y vuelta de cuarentena | 15 |
| §15 redacción de secretos | 5 (el plan serializado no contiene el secreto) |
| §15 el executor solo se prueba en directorios temporales | todos los tests de 8 a 15 usan `mkdtemp` y `HYGIENE_HOME` temporal |
| §18 DoD: restauración con hash, ruta y permisos | 12, 15 |

Las secciones 11 (loop), 12 (init) y 13 (plantilla para agentes) son del plan 3.

**Búsqueda de marcadores.** Ningún paso contiene TBD, TODO ni "similar a la
tarea N". Cada paso que cambia código muestra el código.

**Consistencia de tipos.** `Operation` y `Plan` se definen en la tarea 1 y se
usan sin cambios en las tareas 4, 5, 7, 11 y 13. `EXECUTABLE_TYPES` se define en
`planner/plan.ts` (tarea 4) y lo importan `report/plan.ts` (tarea 5) y
`approvals/approve.ts` (tarea 7). `approvalKey` se define en `store.ts` (tarea
6) y lo usan `approve.ts` (tarea 7) y `clean.ts` (tarea 13). `CapturedPermissions`
y `PermissionRestore` se definen en la tarea 9 y los importa `manifest.ts`
(tarea 10). `QuarantineEntry` se define en la tarea 10 y lo consume
`restoreEntry` (tarea 12). `MoveDeps` se define en la tarea 8 y lo acepta
`quarantineOne` (tarea 11). `resolveDir` se introduce en la tarea 5 y lo reutilizan
`approve` y `clean`. `resolveHome` y `assertHomeOutside` se definen en la tarea
2. `collectAudit` y `AuditFacts` se definen en la tarea 3 y los consume
`runPlan` (tarea 5).

**Riesgos conocidos al ejecutar.**

- El test de ACL de la tarea 9 depende de que `icacls /save` y `/restore`
  funcionen sin privilegios de administrador en el runner `windows-latest`. Si
  CI falla ahí, es un hallazgo real: el executor tendría que reportar `partial`
  y la DoD no se cumpliría en Windows. No se relaja el test.
- La tarea 3 cambia la semántica de las referencias (más casos cuentan como
  indeterminados). No afecta a ningún test existente porque ninguno dependía de
  `referencedPaths` en un árbol con ficheros grandes o ilegibles.
