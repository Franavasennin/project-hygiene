# Ejemplo

Arbol desordenado que usan los tests dorados (`tests/golden/golden.test.ts`).
Cada fichero fuera de `proyecto-a/` esta ahi a proposito, para demostrar una
regla concreta:

- `debug.log` -- no dispara nada (recien creado, FS-TEMP-001 exige 30 dias).
- `notas-final.md` -- dispara FS-NAMING-001 (sufijo "final").
- `resumen.md` -- dispara AI-SCRATCH-001 (fichero de trabajo de agente en raiz).
- `deploy.sh` -- dispara AI-SCRIPT-001 (script de un solo uso en raiz).

Dentro de `proyecto-a/` (que se clasifica como PROYECTO por señales: git,
manifiesto, src+tests, README):

- `config/settings.json` y `config/settings-backup.json` son identicos a
  proposito -- disparan FS-DUP-001 (duplicado) y el segundo tambien
  FS-NAMING-001 (sufijo "backup"). Este es el caso real que FS-DUP-001
  intenta detectar: alguien copia un fichero de configuracion y olvida
  diferenciarlo.
- `server.crt` dispara SEC-CERT-001 (certificado publico, informativo).

Deliberadamente fuera de alcance: ninguna regla del eje `git` se ejercita
aqui, porque este arbol vive dentro del propio repositorio git de
project-hygiene y no es un repositorio git aislado -- `tracked_by_git` no
se comporta de forma fiable en ese caso. Tampoco se incluye ningun secreto
de prueba (ni SEC-SECRET-001 ni SEC-KEY-001), para evitar que un patron
que parezca una clave real dispare escaneres automaticos de terceros una
vez el repositorio sea publico.

Nota sobre este propio fichero: la entropia global de este README (mezcla
de mayusculas, digitos, guiones y backticks en los IDs de regla y las
rutas) supera el umbral de SEC-ENTROPY-001 y aparece como hallazgo en el
fixture dorado. No es un error de la regla ni del fixture -- es
exactamente el comportamiento que SEC-ENTROPY-001 promete: severidad
media, riesgo "unknown" y confianza 0.4, pensado para que una persona lo
revise y descarte, no para bloquear nada. Se deja tal cual en vez de
diluirlo artificialmente con relleno, porque eso empeoraria la
documentacion sin aportar nada real.
