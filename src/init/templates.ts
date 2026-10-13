import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/init -> ../../templates; dist/init -> ../../templates.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(HERE, '..', '..', 'templates');

export function readTemplate(rel: string): Promise<string> {
  return readFile(path.join(TEMPLATES_DIR, ...rel.split('/')), 'utf8');
}

const MARKERS: Array<[string, RegExp]> = [
  ['node', /^package\.json$/],
  ['python', /^(pyproject\.toml|requirements\.txt|setup\.py)$/],
  ['rust', /^Cargo\.toml$/],
  ['go', /^go\.mod$/],
  ['java', /^(pom\.xml|build\.gradle(\.kts)?)$/],
  ['dotnet', /\.(csproj|sln)$/],
];

/** Tecnologias detectadas por los manifiestos de la raiz del proyecto. */
export async function detectTech(root: string): Promise<string[]> {
  const names = await readdir(root);
  return MARKERS.filter(([, re]) => names.some((n) => re.test(n))).map(([tech]) => tech);
}
