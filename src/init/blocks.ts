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
