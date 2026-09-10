export class UnsafeRegexError extends Error {}

const MAX_PATTERN_LENGTH = 1000;

/** Grupo cuantificado que a su vez contiene un cuantificador interno (+, *, ?, {n,m}). */
const NESTED_QUANTIFIER = /\([^()]*[+*?}][^()]*\)\s*([+*]|\{)/;
/** Alternancia con ramas solapables bajo repetición (+, *, o {n,m}). */
const AMBIGUOUS_ALTERNATION = /\([^()]*\|[^()]*\)\s*([+*]|\{)/;

/**
 * Rechaza patrones con riesgo de retroceso exponencial. Es deliberadamente
 * conservador: prefiere rechazar una regla legítima a colgar una auditoría.
 *
 * Limitacion conocida: esta heuristica opera a un solo nivel de anidamiento
 * de parentesis. Un patron como `((a+)b)+` puede escapar a la deteccion
 * porque el cuantificador interno y el externo quedan separados por mas de
 * un nivel de parentesis. Cerrar esto de forma generica exigiria un parser
 * real de expresiones regulares. La red de seguridad para lo que esta
 * heuristica no detecte es el timeout por regla del motor de evaluacion
 * (Budget.startRule / ruleExpired), que interrumpe cualquier regla que se
 * cuelgue durante la ejecucion real, independientemente de si su patron
 * pasó esta comprobacion estatica.
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
