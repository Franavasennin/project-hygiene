import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv } from 'ajv';
import { LIMIT_WIRE_NAMES, type Limits } from '../core/limits.js';
import type { Risk } from '../core/types.js';

export class ConfigError extends Error {}

export interface LoopConfig {
  maxIterations: number;
  stopIfNoImprovement: boolean;
  stopOnRegression: boolean;
  requireApprovalForRisk: Risk[];
}

export interface HygieneConfig {
  limits: Partial<Limits>;
  minConfidence?: number;
  defaultBranch?: string;
  loop: LoopConfig;
}

export const DEFAULT_LOOP: LoopConfig = {
  maxIterations: 10,
  stopIfNoImprovement: true,
  stopOnRegression: true,
  requireApprovalForRisk: ['medium', 'high', 'unknown'],
};

interface RawConfig {
  engine?: Record<string, number | string>;
  planner?: { min_confidence?: number };
  git?: { default_branch?: string };
  loop?: {
    max_iterations?: number;
    stop_if_no_improvement?: boolean;
    stop_on_regression?: boolean;
    require_approval_for_risk?: Risk[];
  };
}

const POSITIVE = { type: 'integer', minimum: 1 };
const SIZE = { anyOf: [POSITIVE, { type: 'string', pattern: '^[0-9]+(KB|MB)$' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    engine: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(Object.values(LIMIT_WIRE_NAMES).map((k) => [
        k, k === 'max_file_size_for_content_scan' ? SIZE : POSITIVE,
      ])),
    },
    planner: {
      type: 'object',
      additionalProperties: false,
      properties: { min_confidence: { type: 'number', minimum: 0, maximum: 1 } },
    },
    git: {
      type: 'object',
      additionalProperties: false,
      properties: { default_branch: { type: 'string', minLength: 1 } },
    },
    loop: {
      type: 'object',
      additionalProperties: false,
      properties: {
        max_iterations: POSITIVE,
        stop_if_no_improvement: { type: 'boolean' },
        stop_on_regression: { type: 'boolean' },
        require_approval_for_risk: {
          type: 'array',
          uniqueItems: true,
          items: { enum: ['safe', 'low', 'medium', 'high', 'unknown'] },
        },
      },
    },
  },
};

const validate = new Ajv({ allErrors: true, strictTypes: false }).compile(SCHEMA);

const WIRE_TO_LIMIT = Object.fromEntries(
  Object.entries(LIMIT_WIRE_NAMES).map(([key, wire]) => [wire, key]),
) as Record<string, keyof Limits>;

function toNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  const n = Number(value.slice(0, -2));
  return value.endsWith('MB') ? n * 1024 * 1024 : n * 1024;
}

async function readRaw(file: string): Promise<RawConfig> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let data: unknown;
  try {
    data = parseYaml(text) ?? {};
  } catch (err) {
    throw new ConfigError(`${file}: YAML invalido: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!validate(data)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
      .join('; ');
    throw new ConfigError(`${file}: ${detail}`);
  }
  return data as RawConfig;
}

function apply(base: HygieneConfig, raw: RawConfig): HygieneConfig {
  const limits: Partial<Limits> = { ...base.limits };
  for (const [wire, value] of Object.entries(raw.engine ?? {})) {
    const key = WIRE_TO_LIMIT[wire];
    if (key) limits[key] = toNumber(value);
  }
  return {
    limits,
    minConfidence: raw.planner?.min_confidence ?? base.minConfidence,
    defaultBranch: raw.git?.default_branch ?? base.defaultBranch,
    loop: {
      maxIterations: raw.loop?.max_iterations ?? base.loop.maxIterations,
      stopIfNoImprovement: raw.loop?.stop_if_no_improvement ?? base.loop.stopIfNoImprovement,
      stopOnRegression: raw.loop?.stop_on_regression ?? base.loop.stopOnRegression,
      requireApprovalForRisk: raw.loop?.require_approval_for_risk ?? base.loop.requireApprovalForRisk,
    },
  };
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HYGIENE_USER_CONFIG ?? path.join(os.homedir(), '.config', 'hygiene', 'config.yml');
}

/**
 * Precedencia (spec §14): `.hygienerc.yml` del root auditado, luego la
 * configuracion de usuario, luego los valores por defecto. Las opciones de
 * CLI se aplican encima en la propia CLI. Los rc de subproyectos no se leen.
 */
export async function loadConfig(root: string, userPath: string = userConfigPath()): Promise<HygieneConfig> {
  const defaults: HygieneConfig = { limits: {}, loop: DEFAULT_LOOP };
  const withUser = apply(defaults, await readRaw(userPath));
  return apply(withUser, await readRaw(path.join(root, '.hygienerc.yml')));
}
