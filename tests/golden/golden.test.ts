import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

describe('fixture dorado', () => {
  it('detecta el conjunto esperado de reglas', async () => {
    const result = await runAudit({
      root: path.join(process.cwd(), 'examples', 'before'),
      rulesDir: path.join(process.cwd(), 'rules'),
    });

    const reglas = [...new Set(result.findings.map((f) => f.ruleId))].sort();
    expect(reglas).toMatchSnapshot();
  });

  it('clasifica proyecto-a como proyecto', async () => {
    const result = await runAudit({
      root: path.join(process.cwd(), 'examples', 'before'),
      rulesDir: path.join(process.cwd(), 'rules'),
    });
    const a = result.inventory.projects.find((p) => p.path === 'proyecto-a');
    expect(a?.status).toBe('project');
  });
});
