import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv, type ValidateFunction } from 'ajv';
import type { Axis, Severity, Risk, SuggestionType } from '../core/types.js';
import { assertSafeRegex, UnsafeRegexError } from './regex-guard.js';

export class PackValidationError extends Error {}

export interface MatchNode {
  all?: MatchNode[];
  any?: MatchNode[];
  none?: MatchNode[];
  [predicate: string]: unknown;
}

export interface Rule {
  id: string;
  title: string;
  why: string;
  severity: Severity;
  risk: Risk;
  confidence: number;
  deprecated?: boolean;
  docs?: string;
  evidence?: string[];
  match: MatchNode;
  suggests: { type: SuggestionType }[];
}

export interface Pack {
  schema_version: 1;
  pack_id: string;
  version: string;
  axis: Axis;
  rules: Rule[];
}

const REGEX_KEYS = new Set(['path_regex', 'basename_regex', 'content_matches']);
const MAX_MATCH_NODES = 256;

/** Recorre el árbol `match` comprobando las regex y el tamaño del árbol. */
function auditMatchTree(node: MatchNode, seen = { n: 0 }): void {
  seen.n += 1;
  if (seen.n > MAX_MATCH_NODES) {
    throw new PackValidationError(`arbol match demasiado grande (> ${MAX_MATCH_NODES} nodos)`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'all' || key === 'any' || key === 'none') {
      for (const child of value as MatchNode[]) auditMatchTree(child, seen);
    } else if (REGEX_KEYS.has(key)) {
      try {
        assertSafeRegex(String(value));
      } catch (err) {
        if (err instanceof UnsafeRegexError) {
          throw new PackValidationError(`regex insegura en ${key}: ${err.message}`);
        }
        throw err;
      }
    }
  }
}

function validateWith(data: unknown, source: string, validate: ValidateFunction): Pack {
  if (!validate(data)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
      .join('; ');
    throw new PackValidationError(`${source}: ${detail}`);
  }
  const pack = data as Pack;
  const ids = new Set<string>();
  for (const rule of pack.rules) {
    if (ids.has(rule.id)) throw new PackValidationError(`${source}: id duplicado ${rule.id}`);
    ids.add(rule.id);
    auditMatchTree(rule.match);
  }
  return pack;
}

const schemaCache = new Map<string, ValidateFunction>();

function compiledValidator(schemaPath: string): ValidateFunction {
  const hit = schemaCache.get(schemaPath);
  if (hit) return hit;
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  schemaCache.set(schemaPath, validate);
  return validate;
}

const DEFAULT_SCHEMA = path.join(process.cwd(), 'rules', 'pack.schema.json');

/** Puerta de entrada síncrona, pensada para tests. */
export function parsePack(yamlText: string, source: string, schemaPath = DEFAULT_SCHEMA): Pack {
  return validateWith(parseYaml(yamlText), source, compiledValidator(schemaPath));
}

/** Puerta de entrada de la CLI: carga todos los packs de un directorio. */
export async function loadPacks(rulesDir: string): Promise<Pack[]> {
  const validate = compiledValidator(path.join(rulesDir, 'pack.schema.json'));
  const names = (await readdir(rulesDir)).filter((n) => n.endsWith('.yml')).sort();
  const packs: Pack[] = [];
  for (const name of names) {
    const raw = await readFile(path.join(rulesDir, name), 'utf8');
    packs.push(validateWith(parseYaml(raw), name, validate));
  }
  return packs;
}
