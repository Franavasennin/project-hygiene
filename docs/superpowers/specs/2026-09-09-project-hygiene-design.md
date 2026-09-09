---
title: project-hygiene — diseño de la v1
date: 2026-09-09
status: aprobado para plan de implementación
---

# project-hygiene — diseño de la v1

Herramienta open source que audita y ordena proyectos existentes y nuevos.
Convierte el crecimiento descontrolado de ficheros, carpetas y artefactos de
agentes en un sistema ordenado, reproducible y reversible.

CLI autónoma en TypeScript sobre Node. Se prueba con `npx project-hygiene`.
La capa de IA es opcional y llega en v3.

---

## 0. Principios

1. **Observe before modify.** Primero se entiende el entorno, después se toca.
2. **Unknown means don't touch.** Lo desconocido no se elimina nunca de forma
   automática, y su sola presencia impide declarar un proyecto limpio.
3. **Reversible by default.** Toda operación destructiva debe poder revertirse.
4. **Policy is separate from execution.** Las reglas determinan qué está mal.
   El planner propone. El usuario aprueba. El executor aplica.

### Invariantes no negociables de la v1

| # | Invariante |
|---|---|
| NN-1 | El motor de reglas corre bajo límites de ejecución explícitos |
| NN-2 | Schema estricto, `additionalProperties: false`, IDs y versiones de regla estables |
| NN-3 | `finding` ≠ `operation` ≠ `execution`, con frontera de aprobación entre las dos últimas |
| NN-4 | `scan`, `audit`, `plan` y `explain` son read-only por contrato |
| NN-5 | La herramienta se audita a sí misma con las mismas reglas, sin excepciones |

Ninguna de estas cinco se relaja por conveniencia de implementación. Si una
funcionalidad exige romper una, se descarta la funcionalidad.

---

## 1. Alcance de la v1

Cuatro ejes de auditoría:

- Sistema de ficheros y límites de proyecto
- Higiene de Git
- Secretos y seguridad
- Higiene de artefactos de IA

Fuera de la v1, y sin que el motor tenga que cambiar para admitirlos:
dependencias, calidad de código, tests, documentación, CI/CD, infraestructura.

---

## 2. Project Detector

Un directorio no es un proyecto por tener `package.json`. Un workspace puede
tener manifiestos en su propia raíz sin dejar de ser un workspace.

El detector acumula señales con peso y produce una confianza.

| Señal | Peso |
|---|---|
| `.git` | fuerte |
| `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `composer.json`, `*.csproj` | medio |
| `src/` junto a `tests/` | complementaria |
| `README` | débil |

Salida por candidato:

```yaml
project:
  path: ./proyecto-a
  confidence: 0.97
  markers: [.git, package.json, src]
```

Umbrales:

- `confidence >= 0.75` → proyecto. Se audita como tal.
- `0.40 <= confidence < 0.75` → `UNKNOWN PROJECT BOUNDARY`. Se inventaría, se
  reporta, no se genera ninguna operación sobre su contenido.
- `confidence < 0.40` → contenido del workspace, no proyecto.

Un **workspace** es un directorio que contiene uno o más proyectos detectados y
cuya propia confianza como proyecto es insuficiente, o cuyos hijos son proyectos
independientes. En modo workspace se auditan los proyectos por separado y además
se aplican reglas propias del nivel superior: ficheros sueltos que no pertenecen
a ningún proyecto, carpetas huérfanas, worktrees sin repo padre.

Un manifiesto en la raíz del workspace no absorbe a los hijos. Los hijos con
confianza suficiente son siempre proyectos independientes.

---

## 3. Pipeline y contrato de efectos

```
CLI → Project Detector → Collectors → INVENTORY(json)
    → Rule Loader (+JSON Schema) → Rule Engine (+limits) → FINDINGS
    → Scorer → SCORE
    → Planner → OPERATIONS
    → Approval → Executor → QUARANTINE → Validator → LOOP
```

Contrato de efectos, invariante NN-4:

| Comando | Efecto |
|---|---|
| `scan` | read-only |
| `audit` | read-only |
| `plan` | read-only |
| `explain` | read-only |
| `approve` | escribe solo en `~/.hygiene/approvals/` |
| `clean` | modifica el workspace |
| `restore` | modifica el workspace |
| `init` | modifica el proyecto |

Los cuatro primeros no escriben un solo byte en ningún sitio, tampoco caché ni
log ni informe, salvo que el usuario pase una ruta de salida explícita.

El motor no sabe qué es basura. El motor sabe que una regla ha detectado una
evidencia. La política asigna severidad. El planner propone una operación a
partir de evidencia, referencias, contexto de proyecto y configuración del
usuario. El usuario aprueba. El executor aplica y deja traza.

---

## 4. Rules-as-data: esquema estricto (NN-2)

Un pack es un documento YAML validado contra JSON Schema con
`additionalProperties: false` en todos los objetos. Un predicado desconocido, un
campo de más o una versión de schema incompatible hacen fallar la carga del pack
con error, no con aviso.

Campos obligatorios del pack: `schema_version`, `pack_id`, `version`, `axis`,
`rules`. Campos obligatorios de la regla: `id`, `title`, `why`, `severity`,
`risk`, `confidence`, `match`, `suggests`.

```yaml
schema_version: 1
pack_id: hygiene.filesystem.core
version: 1.0.0
axis: filesystem
rules:
  - id: FS-NAMING-001
    title: Fichero versionado a mano por el nombre
    why: >
      Un sufijo como final, v2, copy, backup u old indica una copia manual que
      sustituye al control de versiones. Suele quedar huérfana. No implica que
      el fichero sea prescindible.
    severity: medium
    risk: medium
    confidence: 0.7
    match:
      all:
        - basename_regex: '(?i)[-_ ](final|v[0-9]+|copy|backup|old|prueba|temp)[0-9]*(\.[^.]+)?$'
        - is_file: true
    evidence: [path, basename, size, mtime, sha256, git_status]
    suggests:
      - type: review
    docs: rules/FS-NAMING-001.md
```

`id` es único y estable de por vida. Un ID nunca se reutiliza para otra regla.
Retirar una regla se hace marcándola `deprecated: true`, no borrando el ID.
Los IDs siguen el patrón `EJE-FAMILIA-NNN`: `FS-ROOT-001`, `FS-BOUNDARY-001`,
`GIT-IGNORE-001`, `SEC-SECRET-001`, `AI-SCRATCH-001`.

### Vocabulario cerrado de predicados

- Ruta: `glob`, `path_regex`, `basename_regex`, `depth_gt`
- Metadatos: `is_file`, `is_dir`, `is_symlink`, `is_empty`, `size_gt`,
  `size_lt`, `older_than`, `newer_than`
- Git: `tracked_by_git`, `ignored_by_git`, `git_status`, `in_git_history`
- Contenido: `content_matches`, `entropy_gt`, `sha256_duplicate`
- Referencias: `referenced_by_source`
- Combinadores: `all`, `any`, `none`

Ningún predicado ejecuta shell, abre red ni escribe. `move` y `create` no
aceptan destino en la regla: el destino lo decide el planner.

---

## 5. Límites de ejecución del motor (NN-1)

Que un YAML no pueda ejecutar shell no lo hace inocuo. Una regla puede provocar
ReDoS, recorrer árboles gigantes, escanear contenido de ficheros enormes, barrer
el histórico completo de Git o combinar `any`/`all` hasta agotar memoria.

El motor corre con presupuesto explícito y configurable:

```yaml
engine:
  max_files_scanned: 200000
  max_file_size_for_content_scan: 2MB
  max_regex_steps: 100000
  max_rule_matches: 5000
  max_git_history_commits: 5000
  max_reference_search_files: 20000
  max_match_tree_nodes: 256
  timeout_ms_per_rule: 5000
  timeout_ms_total: 300000
```

Las expresiones regulares se ejecutan con un motor de backtracking acotado por
pasos. Superar cualquier límite produce un resultado explícito y visible:

```
RULE_EXECUTION_LIMIT  rule=FS-NAMING-001 limit=timeout_ms_per_rule
```

Ese resultado degrada el eje afectado a `incompleto`, aparece en el informe e
impide declarar el proyecto limpio. Nunca se silencia ni se convierte en "sin
hallazgos".

---

## 6. Finding ≠ Operation ≠ Execution (NN-3)

Una regla dice que algo es sospechoso. No dice qué hacer con ello.

```
RULE + EVIDENCE + REFERENCES + PROJECT CONTEXT + USER POLICY = OPERATION
```

`backup.sql` puede ser basura o la única copia de una base de datos. Por eso
`FS-NAMING-001` sugiere `review` y nunca `quarantine` por el solo hecho de que
el nombre contenga `backup`.

Tipos de operación: `quarantine`, `ignore`, `move`, `create`, `review`, `none`.

Reglas del planner:

- Si la confianza efectiva del hallazgo queda por debajo del umbral configurado,
  la operación se degrada a `review` sea cual sea la sugerencia.
- Si `referenced_by_source` es verdadero o no se pudo determinar, nunca se
  propone `quarantine`.
- Todo hallazgo clasificado `unknown` produce `review` y nada más.
- Cada operación recibe un ID estable dentro del plan: `OP-000123`.

---

## 7. Reglas de los cuatro ejes

### Sistema de ficheros y límites

`FS-ROOT-001` fichero suelto en la raíz del workspace fuera de todo proyecto.
`FS-BOUNDARY-001` frontera de proyecto con confianza insuficiente.
`FS-GENERATED-001` directorio generado (`node_modules`, `dist`, `.venv`,
`target`); nunca se pone en cuarentena, solo se comprueba que esté ignorado.
`FS-TEMP-001` logs. `FS-TEMP-002` comprimidos abandonados en la raíz.
`FS-TEMP-003` medios sueltos. `FS-DUP-001` duplicados por hash.
`FS-NAMING-001` versionado manual por el nombre. `FS-DEPTH-001` anidamiento
excesivo. `FS-EMPTY-001` directorio vacío. `FS-SYMLINK-001` enlace que apunta
fuera del proyecto.

### Git

`GIT-NOREPO-001` proyecto con código y sin repositorio.
`GIT-IGNORE-001` sin `.gitignore`. `GIT-IGNORE-002` artefacto generado
versionado. `GIT-DIRTY-001` cambios sin commitear con antigüedad.
`GIT-WORKTREE-001` worktree sin repo padre. `GIT-STASH-001` stashes antiguos.
`GIT-LARGE-001` blob grande en el histórico.

`GIT-BRANCH-001` distingue dos estados y jamás propone tocar una rama:

- `stale`: sin actividad por encima del umbral, pero con upstream y mergeable.
- `orphaned`: sin upstream, sin autor reciente y sin relación con la rama por
  defecto.

La rama por defecto se resuelve en este orden: `origin/HEAD`, la rama
configurada en `.hygienerc.yml`, `main`, `master`. Si no se puede resolver, la
regla no emite hallazgo, porque "sin mergear" sin referencia no significa nada.
La acción siempre es `review`.

### Secretos y seguridad

Contrato del collector: el valor coincidente jamás sale del collector. Se
sustituye por su huella antes de construir el hallazgo.

```
secret found → redact → fingerprint → finding
```

```json
{
  "path": ".env",
  "rule": "SEC-SECRET-001",
  "type": "api-key",
  "fingerprint": "sha256:9f2b…",
  "line": 12,
  "exposed": true
}
```

Falsos positivos contemplados desde la v1:

- **Certificados.** Una clave privada (`.pem` con bloque privado, `id_rsa`) es
  crítica. Un certificado con clave pública (`.crt`, `.cer`) es informativo y su
  acción es `review`. No son la misma regla.
- **Bases de datos.** Un volcado no es malo por existir.
  `tests/fixtures/database.sql` es legítimo. La regla pondera ubicación, si está
  versionado, si está referenciado y el tipo de proyecto antes de penalizar.
- **Alta entropía.** Una cadena de alta entropía puede ser un hash, un UUID, un
  JWT, una huella de asset o contenido comprimido. `entropy_gt` produce siempre
  `potential-secret`. Solo un detector de tipo específico puede elevarlo a
  `confirmed-secret`.

`SEC-HIST-001` señala secretos en el histórico y nunca reescribe historia.
`SEC-PERM-001` comprueba permisos donde la plataforma lo permite y reporta
`unsupported` donde no.

### Artefactos de IA

`AI-DOC-001` ficheros de instrucciones duplicados o en conflicto entre niveles.
`AI-SCRATCH-001` planes y scratch de agente fuera de `.tmp`.
`AI-SCRIPT-001` script de un solo uso abandonado en la raíz.
`AI-REPORT-001` informe generado que nada referencia.
`AI-STATE-001` estado o caché de agente sin ignorar.
`AI-OUTSIDE-001` directorio creado por un agente fuera del PROJECT ROOT.
`AI-DUPDOC-001` documentación generada que duplica el README.

---

## 8. Cuarentena: journal de operaciones, no papelera

La cuarentena vive **fuera** del workspace auditado, para no crear una carpeta
que la propia herramienta tendría que auditar después.

```
~/.hygiene/
├── quarantine/
│   └── 2026-09-09/
│       └── OP-000123/
│           ├── manifest.json
│           └── payload/
├── approvals/
├── reports/
└── state/
```

La ruta base es configurable. Nunca cae dentro de un proyecto auditado.

```json
{
  "operation_id": "OP-000123",
  "created_at": "2026-09-09T08:12:44Z",
  "source": "C:/Users/x/ws/debug-final-v2.ts",
  "quarantine_path": "~/.hygiene/quarantine/2026-09-09/OP-000123/payload/debug-final-v2.ts",
  "sha256": "…",
  "size": 12345,
  "platform": "win32",
  "permissions": { "model": "acl", "captured": true, "data": "…" },
  "rule_ids": ["FS-NAMING-001"],
  "reason": "…",
  "restorable": true
}
```

```
CLEAN → MOVE → QUARANTINE → MANIFEST
RESTORE → VERIFY HASH → RETURN
```

`restore` verifica el hash antes de devolver el fichero. Si no coincide, aborta
esa operación, lo reporta y no toca el workspace.

Preservación de metadatos según capacidad de plataforma, nunca fingiendo éxito:

- Linux y macOS: modo POSIX, y propietario cuando sea posible.
- Windows: ACL o descriptor de seguridad cuando sea posible.
- Cuando no sea posible: `permissions.captured: false` y `unsupported` en el
  informe de restauración.

---

## 9. Aprobación y clean

La unidad de aprobación es la operación, no el nivel de riesgo. Dentro de un
mismo nivel conviven cosas incomparables: poner en cuarentena un log abandonado,
mover un script y modificar un `.gitignore`.

```
hygiene approve OP-001 OP-002
hygiene approve --risk safe      # filtro de conveniencia, expande a IDs
```

`--risk` es un atajo que se expande a una lista explícita de IDs y se registra
como tal en `~/.hygiene/approvals/`. La aprobación queda siempre materializada
en operaciones concretas.

Barrera final:

```
hygiene clean --approved     # ejecuta solo lo registrado como aprobado
hygiene clean                # ERROR: No approved operations. Nothing was modified.
```

Una aprobación caduca si el plan que la originó ya no coincide con el estado del
disco. El executor revalida hash y ruta de cada origen antes de mover.

---

## 10. Scoring v1

Perfil `v1-core`. Dos puntuaciones solo son comparables si comparten perfil y
versión de motor.

| Eje | Peso W | Saturación D |
|---|---|---|
| Sistema de ficheros | 30 | 60 |
| Git | 25 | 40 |
| Secretos y seguridad | 30 | 40 |
| Higiene de IA | 15 | 30 |

Peso por severidad: `info` 0, `low` 1, `medium` 3, `high` 8, `critical` 20.

```
penalty(rule)  = severity_weight(rule) × sqrt(findings(rule))
P(axis)        = Σ penalty(rule) para las reglas del eje
score(axis)    = W(axis) × max(0, 1 − P(axis) / D(axis))
score(total)   = round(Σ score(axis))
```

La función es determinista, está documentada y tiene test propio con casos
tabulados. La raíz cuadrada da rendimientos decrecientes: cien logs pesan diez
veces más que uno, no cien.

Dos reglas duras por encima de la fórmula:

- Un hallazgo `critical`, y un secreto versionado lo es, limita el total a 59 y
  marca el proyecto como no limpio.
- Cualquier `unknown` o cualquier `RULE_EXECUTION_LIMIT` impide declarar limpio,
  aunque no resten puntos. Restar por lo que no entiendes es fingir que lo
  entiendes.

---

## 11. Loop

```
AUDIT → SCORE → PLAN → APPROVAL POLICY → EXECUTE → VALIDATE → AUDIT → COMPARE
```

```yaml
loop:
  max_iterations: 10
  stop_if_no_improvement: true
  stop_on_regression: true
  require_approval_for_risk: [medium, high, unknown]
```

El loop termina cuando `score_new <= score_old`, cuando no quedan mejoras
aprobadas por aplicar, o al alcanzar el tope de iteraciones. Nunca se persigue
el 100 por sí mismo: perseguirlo produce ciclos absurdos de 98 a 99 y vuelta.
Una regresión detiene el loop y deja el informe comparativo.

---

## 12. Modo prevención: `hygiene init`

Idempotente. No sobrescribe nada sin copia previa en cuarentena.

Completa el `.gitignore` según las tecnologías detectadas. Instala un hook de
pre-commit que ejecuta el eje de secretos y bloquea el commit ante un secreto
expuesto. Crea `.tmp/` con su entrada en el ignore, como vertedero legítimo que
evita los `debug2.js`. Añade un bloque de reglas para agentes al fichero de
instrucciones existente, sin crear uno nuevo. Deja `.hygienerc.yml`. De forma
opcional añade un workflow de CI que ejecuta `hygiene audit --json`.

---

## 13. Comportamiento con Claude Code y otros agentes

`hygiene init` inyecta la plantilla de reglas para agentes en el fichero de
instrucciones del proyecto. `--json` es la interfaz de máquina y es estable.
`hygiene explain <RULE-ID>` devuelve el porqué de una regla para que el agente
razone sobre el hallazgo en vez de obedecerlo.

El agente puede ejecutar `scan`, `audit`, `plan` y `explain`. El agente no cruza
la frontera de aprobación. Un agente que aprueba sus propias operaciones
destructivas anula el diseño entero.

---

## 14. CLI y configuración

| Comando | Qué hace |
|---|---|
| `hygiene scan` | Inventario, sin juicio |
| `hygiene audit` | Hallazgos y puntuación |
| `hygiene plan` | Operaciones con ID |
| `hygiene approve <IDs>` | Registra aprobación |
| `hygiene clean --approved` | Ejecuta lo aprobado a cuarentena |
| `hygiene restore <OP-ID>` | Deshace, verificando hash |
| `hygiene explain <RULE-ID>` | Documenta una regla |
| `hygiene init` | Modo prevención |
| `hygiene loop` | Ciclo acotado |

Precedencia de configuración: opciones de CLI, `.hygienerc.yml` del proyecto,
`.hygienerc.yml` del workspace, `~/.config/hygiene/config.yml`, valores por
defecto.

Códigos de salida: `0` limpio, `1` hallazgos por encima del umbral, `2` fallo de
la herramienta. Son cosas distintas y no se confunden en CI.

---

## 15. Estrategia de tests

- Unitarios por predicado contra árboles sintéticos en directorio temporal.
- Fixtures dorados en `examples/before/` y `examples/after/`, con el JSON de
  hallazgos como snapshot. Son también la documentación viva de qué detecta.
- **Test de invariante de efectos.** `scan`, `audit`, `plan` y `explain` con el
  sistema de ficheros interceptado; falla si se produce una sola escritura. Es
  el test más importante del proyecto.
- Ida y vuelta de cuarentena: se llena un árbol, se pone en cuarentena, se
  restaura, y se verifica hash, ruta y metadatos según plataforma.
- Validación de todos los packs contra el JSON Schema en CI.
- Tests de límites del motor: una regla con regex patológica debe producir
  `RULE_EXECUTION_LIMIT`, no colgarse.
- Tests de redacción: ningún fixture de secreto aparece en claro en ninguna
  salida, verificado por búsqueda sobre el JSON emitido.

El executor solo se prueba en directorios temporales.

---

## 16. Arquitectura del repositorio

```
project-hygiene/
├── src/
│   ├── cli/
│   ├── detector/
│   ├── collectors/        filesystem, git, security, ai
│   ├── engine/            evaluador de predicados + límites
│   ├── scorer/
│   ├── planner/
│   ├── executor/          quarantine, restore, manifest
│   └── report/
├── rules/                 packs YAML + JSON Schema
├── templates/             gitignore, hooks, agents, ci
├── examples/before|after/
├── tests/
├── docs/
└── README.md  LICENSE  SECURITY.md  CONTRIBUTING.md
```

---

## 17. Roadmap

**v1** cuatro ejes, detector, cuarentena, aprobación por operación, prevención.

**v2** dependencias, documentación, tests y CI como packs nuevos sin tocar el
motor; informe HTML y salida SARIF.

**v3** capa de IA opcional para clasificar los `unknown`, packs de comunidad,
arquitecturas objetivo por framework.

---

## 18. Definition of Done de la v1

- Se instala con `npx` y corre en Windows, macOS y Linux.
- Audita un workspace completo sin escribir un byte fuera de `~/.hygiene/`.
- Todo fichero en cuarentena se restaura con hash y ruta idénticos, y con
  metadatos de permisos preservados según las capacidades de la plataforma,
  reportando `unsupported` en lugar de fingir éxito.
- Ningún secreto aparece en claro en ningún informe ni inventario.
- Todo pack valida contra el schema; el motor rechaza predicados desconocidos.
- Los límites de ejecución están activos y probados.
- Los fixtures dorados pasan.
- El README documenta los cuatro principios.
- `hygiene audit ./project-hygiene` forma parte del CI y el repositorio pasa
  usando exactamente las mismas reglas que cualquier otro proyecto, sin
  excepciones ni listas de exclusión propias. Si alguien añade
  `debug-final-v2-old.ts`, el CI del propio proyecto falla.
