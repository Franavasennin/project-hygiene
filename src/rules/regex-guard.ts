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
