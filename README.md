# project-hygiene

Audits and organizes software projects and AI-assisted development environments.

Turn AI-assisted vibe coding into maintainable software engineering.

> **project-hygiene nunca modifica nada sin una aprobación explícita por
> operación.** `scan`, `audit`, `plan` y `explain` son de solo lectura por
> contrato (hay un test que falla si alguna vez escriben en disco). `clean`
> solo mueve a una cuarentena fuera del workspace lo que se aprobó antes con
> `approve`, y `restore` lo devuelve verificando el hash.

## Principios

1. **Observe before modify.** Primero se entiende el entorno, después se toca.
2. **Unknown means don't touch.** Lo desconocido no se elimina automáticamente.
3. **Reversible by default.** Toda operación destructiva debe poder revertirse.
4. **Policy is separate from execution.** Las reglas dicen qué está mal. El
   usuario aprueba. El ejecutor aplica.

Ver la [especificación de diseño completa](docs/superpowers/specs/2026-09-09-project-hygiene-design.md)
para el detalle de los cinco invariantes no negociables (NN-1 a NN-5) y el
razonamiento detrás de cada decisión.

## Uso

Mientras el paquete no esté publicado en npm, se usa localmente:

```bash
npm install
npm run build
node dist/cli/index.js scan .
node dist/cli/index.js audit .
node dist/cli/index.js audit . --json
node dist/cli/index.js explain FS-NAMING-001
```

Una vez publicado en npm, el binario se llamará `hygiene` y podrá invocarse con:

```bash
npx project-hygiene scan .
```

(el nombre del paquete es `project-hygiene`, pero el comando que instala es `hygiene`).

`scan` imprime el inventario en bruto (sin juicio). `audit` ejecuta las reglas
y produce hallazgos y puntuación. `explain <RULE-ID>` muestra por qué existe
una regla concreta. `--json` da salida legible por máquina en `audit` y
`explain`; `--help` muestra el uso.

Códigos de salida: `0` limpio, `1` hallazgos, `2` fallo de la herramienta.

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

## Qué audita hoy

Cuatro ejes: sistema de ficheros y límites de proyecto, higiene de Git, secretos
y seguridad, y artefactos de agentes de IA. Las reglas viven en `rules/` como
YAML legible. Añadir una no requiere tocar el motor.

## Desarrollo

Requiere Node 20 o superior (ver `engines` en `package.json`).

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dogfood
```

`npm run dogfood` construye el proyecto y ejecuta `audit` sobre sus propias
carpetas `src` y `rules`, para detectar en cada cambio si la herramienta se
audita bien a sí misma.

## Estado

v1 completa en tres entregas: núcleo de solo lectura; planner, aprobación y
cuarentena reversible; y ejes completos con prevención (`init`) y ciclo
(`loop`). `clean` ejecuta cuarentenas e `ignore`; `create` solo lo hace
`init`.

Pendiente fuera de la v1: publicación en npm, `.hygienerc.yml` por
subproyecto, detección de instrucciones de agente en conflicto, y los packs y
salidas de la v2 (dependencias, documentación, tests, CI, HTML, SARIF).

## Reglas disponibles

32 reglas repartidas en cuatro ejes.

### Sistema de ficheros (`rules/filesystem.yml`)

| ID | Título |
| --- | --- |
| FS-TEMP-001 | Fichero de log abandonado |
| FS-TEMP-002 | Archivo comprimido abandonado |
| FS-NAMING-001 | Fichero versionado a mano por el nombre |
| FS-DUP-001 | Fichero duplicado por contenido |
| FS-DEPTH-001 | Anidamiento excesivo |
| FS-SYMLINK-001 | Enlace simbólico |
| FS-ROOT-001 | Fichero suelto en la raíz del workspace |
| FS-BOUNDARY-001 | Frontera de proyecto con confianza insuficiente |
| FS-GENERATED-001 | Directorio generado sin ignorar |
| FS-EMPTY-001 | Directorio vacío |

### Git (`rules/git.yml`)

| ID | Título |
| --- | --- |
| GIT-IGNORE-002 | Artefacto generado versionado |
| GIT-DIRTY-001 | Cambio sin commitear con antigüedad |
| GIT-LARGE-001 | Fichero grande versionado |
| GIT-NOREPO-001 | Proyecto con código y sin repositorio |
| GIT-IGNORE-001 | Repositorio sin .gitignore |
| GIT-WORKTREE-001 | Worktree sin repositorio padre |
| GIT-STASH-001 | Stash antiguo |
| GIT-BRANCH-001 | Rama inactiva |

### Seguridad (`rules/security.yml`)

| ID | Título |
| --- | --- |
| SEC-SECRET-001 | Fichero de entorno versionado |
| SEC-KEY-001 | Clave privada en el árbol |
| SEC-CERT-001 | Certificado con clave pública |
| SEC-ENTROPY-001 | Posible secreto por alta entropía |
| SEC-DB-001 | Volcado de base de datos versionado |
| SEC-PERM-001 | Clave privada con permisos abiertos |
| SEC-HIST-001 | Secreto en el histórico de Git |

### Agentes de IA (`rules/ai.yml`)

| ID | Título |
| --- | --- |
| AI-SCRATCH-001 | Fichero de trabajo de agente fuera de .tmp |
| AI-SCRIPT-001 | Script de un solo uso en la raíz |
| AI-STATE-001 | Estado o caché de agente sin ignorar |
| AI-DOC-001 | Fichero de instrucciones de agente duplicado |
| AI-REPORT-001 | Informe generado que nada referencia |
| AI-OUTSIDE-001 | Directorio de agente fuera de todo proyecto |
| AI-DUPDOC-001 | Documentación que duplica el README |

Las reglas de proyecto (`scope: project`) se evalúan una vez por proyecto
detectado, incluida la raíz. `SEC-PERM-001` se reporta como no soportada en
Windows, sin restar puntos ni bloquear el estado limpio.

## Licencia

Apache 2.0. Ver [LICENSE](./LICENSE).
