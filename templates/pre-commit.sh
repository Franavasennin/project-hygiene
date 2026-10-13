# Bloquea el commit si hygiene detecta un secreto expuesto (severidad high o mayor).
if command -v hygiene >/dev/null 2>&1; then
  hygiene audit . --axis security --fail-on high || exit 1
elif command -v npx >/dev/null 2>&1 && npx --no-install hygiene --help >/dev/null 2>&1; then
  npx --no-install hygiene audit . --axis security --fail-on high || exit 1
else
  echo "hygiene no esta instalado: no se ha comprobado si hay secretos." >&2
fi
