import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENGINE_VERSION, SCORE_PROFILE } from '../src/core/version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

describe('andamiaje', () => {
  it('ENGINE_VERSION coincide con package.json', () => {
    expect(ENGINE_VERSION).toBe(pkg.version);
  });

  it('expone el perfil de score', () => {
    expect(SCORE_PROFILE).toBe('v1-core');
  });
});
