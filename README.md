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
npx project-hygiene scan .
npx project-hygiene audit .
npx project-hygiene audit . --json
npx project-hygiene explain FS-NAMING-001
```

`scan` imprime el inventario en bruto (sin juicio). `audit` ejecuta las reglas
y produce hallazgos y puntuación. `explain <RULE-ID>` muestra por qué existe
una regla concreta. `--json` da salida legible por máquina en `audit` y
`explain`; `--help` muestra el uso.

Códigos de salida: `0` limpio, `1` hallazgos, `2` fallo de la herramienta.

## Qué audita hoy

Cuatro ejes: sistema de ficheros y límites de proyecto, higiene de Git, secretos
y seguridad, y artefactos de agentes de IA. Las reglas viven en `rules/` como
YAML legible. Añadir una no requiere tocar el motor.

En esta versión la herramienta **no modifica nada**. `scan`, `audit` y `explain`
son de solo lectura por contrato, y hay un test que falla si alguna vez escriben.

## Desarrollo

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

Esta es la primera de tres entregas planeadas para project-hygiene.

Esta entrega (**núcleo de solo lectura**) incluye:

- Detección de proyectos.
- Los tres collectors (sistema de ficheros, contenido, git).
- El motor de reglas, con límites de ejecución explícitos.
- El scorer.
- Los cuatro packs de reglas (`rules/filesystem.yml`, `rules/git.yml`,
  `rules/security.yml`, `rules/ai.yml`).
- La CLI, con los comandos `scan`, `audit` y `explain`.
- ~110 tests.

Lo que **no** incluye todavía, y por qué:

- **No hay `clean`/`quarantine`/`restore`.** Eso es el planner + executor +
  cuarentena, que corresponde a la segunda entrega.
- **No hay `init`/`loop` ni plantillas para nuevos proyectos.** Eso queda para
  la tercera entrega.
- **El predicado `in_git_history` no está implementado.** Detectar secretos en
  el histórico de git (no solo en el árbol actual) queda diferido.

## Reglas disponibles

16 reglas repartidas en cuatro ejes.

### Sistema de ficheros (`rules/filesystem.yml`)

| ID | Título |
| --- | --- |
| FS-TEMP-001 | Fichero de log abandonado |
| FS-TEMP-002 | Archivo comprimido abandonado |
| FS-NAMING-001 | Fichero versionado a mano por el nombre |
| FS-DUP-001 | Fichero duplicado por contenido |
| FS-DEPTH-001 | Anidamiento excesivo |
| FS-SYMLINK-001 | Enlace simbólico |

### Git (`rules/git.yml`)

| ID | Título |
| --- | --- |
| GIT-IGNORE-002 | Artefacto generado versionado |
| GIT-DIRTY-001 | Cambio sin commitear con antigüedad |
| GIT-LARGE-001 | Fichero grande versionado |

### Seguridad (`rules/security.yml`)

| ID | Título |
| --- | --- |
| SEC-SECRET-001 | Fichero de entorno versionado |
| SEC-KEY-001 | Clave privada en el árbol |
| SEC-CERT-001 | Certificado con clave pública |
| SEC-ENTROPY-001 | Posible secreto por alta entropía |

### Agentes de IA (`rules/ai.yml`)

| ID | Título |
| --- | --- |
| AI-SCRATCH-001 | Fichero de trabajo de agente fuera de .tmp |
| AI-SCRIPT-001 | Script de un solo uso en la raíz |
| AI-STATE-001 | Estado o caché de agente sin ignorar |

## Licencia

Apache 2.0. Ver [LICENSE](./LICENSE).
