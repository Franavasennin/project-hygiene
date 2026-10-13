## Higiene del proyecto (project-hygiene)

- Ficheros temporales, planes y borradores van en `.tmp/`, nunca en la raiz.
- No crees copias versionadas a mano (`-final`, `-v2`, `-backup`): usa Git.
- No dejes scripts de un solo uso en la raiz del proyecto.
- Puedes ejecutar `hygiene scan`, `hygiene audit`, `hygiene plan` y `hygiene explain <RULE-ID>`.
- No ejecutes `hygiene approve`, `hygiene clean`, `hygiene loop` ni `hygiene restore`: aprobar y aplicar cambios es decision de una persona.
