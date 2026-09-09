import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION, SCORE_PROFILE } from '../src/core/version.js';

describe('andamiaje', () => {
  it('expone version de motor y perfil de score', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
    expect(SCORE_PROFILE).toBe('v1-core');
  });
});
