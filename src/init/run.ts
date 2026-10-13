import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { applyEdit, readTextOrNull, type EditOutcome } from '../executor/edit.js';
import { replaceBlock } from './blocks.js';
import { detectTech, readTemplate } from './templates.js';

export interface InitOptions {
  root: string;
  home: string;
  ci?: boolean;
  now?: Date;
}

export interface InitAction {
  file: string;
  status: 'created' | 'updated' | 'unchanged' | 'skipped';
  reason?: string;
  entry?: string;
}

const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md'];

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

function toAction(file: string, o: EditOutcome): InitAction {
  if (o.status === 'applied') return { file, status: o.created ? 'created' : 'updated', entry: o.entry };
  if (o.status === 'unchanged') return { file, status: 'unchanged' };
  return { file, status: 'skipped', reason: o.reason };
}

/**
 * Modo prevencion (spec §12). Idempotente y sin pisar nada ajeno; cada
 * escritura queda en el journal como INIT-NNNNNN y se deshace con restore.
 */
export async function runInit(o: InitOptions): Promise<InitAction[]> {
  const actions: InitAction[] = [];
  let n = 0;
  const edit = async (file: string, transform: (cur: string | null) => string, mode?: number) => {
    n += 1;
    const outcome = await applyEdit({
      root: o.root, home: o.home, opId: `INIT-${String(n).padStart(6, '0')}`, file,
      transform, mode, ruleIds: [], reason: 'hygiene init', now: o.now,
    });
    actions.push(toAction(file, outcome));
  };

  // 1. .gitignore segun las tecnologias detectadas.
  const techs = await detectTech(o.root);
  const parts = await Promise.all(['common', ...techs].map((t) => readTemplate(`gitignore/${t}.txt`)));
  const body = [...new Set(parts.join('\n').split(/\r?\n/).filter(Boolean))].join('\n');
  await edit('.gitignore', (cur) => replaceBlock(cur, '# >>> hygiene', '# <<< hygiene', body));

  // 2. .tmp/ como vertedero legitimo (ya ignorado por el bloque anterior).
  const tmp = path.join(o.root, '.tmp');
  if (await isDir(tmp)) {
    actions.push({ file: '.tmp/', status: 'unchanged' });
  } else {
    await mkdir(tmp);
    actions.push({ file: '.tmp/', status: 'created' });
  }

  // 3. .hygienerc.yml si no existe.
  const rc = await readTemplate('hygienerc.yml');
  await edit('.hygienerc.yml', (cur) => cur ?? rc);

  // 4. Reglas para agentes en el fichero de instrucciones existente, sin crear uno.
  const agents = await readTemplate('agents.md');
  let agentFile: string | null = null;
  for (const f of AGENT_FILES) {
    if (await isFile(path.join(o.root, f))) {
      agentFile = f;
      break;
    }
  }
  if (agentFile) {
    await edit(agentFile, (cur) => replaceBlock(cur, '<!-- >>> hygiene -->', '<!-- <<< hygiene -->', agents));
  } else {
    actions.push({ file: 'CLAUDE.md', status: 'skipped', reason: 'no hay fichero de instrucciones de agente; no se crea uno nuevo' });
  }

  // 5. Hook de pre-commit, solo en un repo y sin pisar uno ajeno.
  const hookFile = '.git/hooks/pre-commit';
  if (!(await isDir(path.join(o.root, '.git')))) {
    actions.push({ file: hookFile, status: 'skipped', reason: 'no es un repositorio git' });
  } else {
    const hookBody = await readTemplate('pre-commit.sh');
    const hookAbs = path.join(o.root, '.git', 'hooks', 'pre-commit');
    const foreign = (await isFile(hookAbs)) && !(await readTextOrNull(hookAbs))?.includes('# >>> hygiene');
    if (foreign) {
      actions.push({ file: hookFile, status: 'skipped', reason: 'ya existe un hook pre-commit ajeno; no se toca' });
    } else {
      await edit(hookFile, (cur) => replaceBlock(cur ?? '#!/bin/sh\n', '# >>> hygiene', '# <<< hygiene', hookBody), 0o755);
    }
  }

  // 6. Workflow de CI opcional.
  if (o.ci) {
    const ci = await readTemplate('ci-hygiene.yml');
    await edit('.github/workflows/hygiene.yml', (cur) => cur ?? ci);
  }

  return actions;
}
