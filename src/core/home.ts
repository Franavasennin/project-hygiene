import os from 'node:os';
import path from 'node:path';
import { realpath } from 'node:fs/promises';

export class HomeInsideWorkspaceError extends Error {}

/** Base de cuarentena y aprobaciones. Configurable con HYGIENE_HOME. */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const custom = env.HYGIENE_HOME;
  if (custom && custom.trim() !== '') return path.resolve(custom);
  return path.join(os.homedir(), '.hygiene');
}

/**
 * realpath del ancestro existente mas cercano, mas el resto sin resolver. La
 * base puede no existir todavia y aun asi hay que compararla con rutas reales
 * (en macOS, /var es un enlace a /private/var).
 */
async function realpathLoose(p: string): Promise<string> {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let current = abs;
  for (;;) {
    try {
      const real = await realpath(current);
      return path.join(real, ...[...rest].reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function contains(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * La cuarentena vive fuera del workspace (spec §8): si cayera dentro, la
 * herramienta crearia una carpeta que ella misma tendria que auditar.
 */
export async function assertHomeOutside(home: string, root: string): Promise<void> {
  const h = await realpathLoose(home);
  const r = await realpathLoose(root);
  if (contains(r, h)) {
    throw new HomeInsideWorkspaceError(
      `la base de hygiene (${h}) cae dentro del workspace auditado (${r}); define HYGIENE_HOME fuera de el`,
    );
  }
  if (contains(h, r)) {
    throw new HomeInsideWorkspaceError(
      `el workspace auditado (${r}) cae dentro de la base de hygiene (${h})`,
    );
  }
}
