import { chmod, chown, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

export type PermissionModel = 'posix' | 'acl' | 'none';

export interface CapturedPermissions {
  model: PermissionModel;
  /** false si la plataforma no lo permite o la captura fallo. Nunca se finge. */
  captured: boolean;
  data: { mode: number; uid: number; gid: number } | { aclFile: string } | null;
}

/** restored: todo; partial: el fichero volvio pero no todos sus metadatos. */
export type PermissionRestore = 'restored' | 'partial' | 'unsupported';

const ACL_FILE = 'acl.txt';

/**
 * Captura permisos antes de mover (spec §8). En Windows guarda la ACL con
 * `icacls /save` en la carpeta de la entrada; en Linux y macOS, modo y
 * propietario. execFile no pasa por shell.
 */
export async function capturePermissions(
  absPath: string,
  entryDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<CapturedPermissions> {
  if (platform === 'win32') {
    try {
      await run('icacls', [absPath, '/save', path.join(entryDir, ACL_FILE), '/q']);
      return { model: 'acl', captured: true, data: { aclFile: ACL_FILE } };
    } catch {
      return { model: 'acl', captured: false, data: null };
    }
  }
  if (platform === 'linux' || platform === 'darwin') {
    const s = await stat(absPath);
    return { model: 'posix', captured: true, data: { mode: s.mode & 0o7777, uid: s.uid, gid: s.gid } };
  }
  return { model: 'none', captured: false, data: null };
}

export async function applyPermissions(
  absPath: string,
  entryDir: string,
  perms: CapturedPermissions,
): Promise<PermissionRestore> {
  if (!perms.captured || !perms.data) return 'unsupported';

  if (perms.model === 'acl' && 'aclFile' in perms.data) {
    try {
      // icacls /restore aplica la ACL a los ficheros del directorio que
      // aparecen por nombre en el fichero guardado.
      await run('icacls', [path.dirname(absPath), '/restore', path.join(entryDir, perms.data.aclFile), '/q']);
      return 'restored';
    } catch {
      return 'partial';
    }
  }

  if (perms.model === 'posix' && 'mode' in perms.data) {
    await chmod(absPath, perms.data.mode);
    const s = await stat(absPath);
    if (s.uid === perms.data.uid && s.gid === perms.data.gid) return 'restored';
    try {
      await chown(absPath, perms.data.uid, perms.data.gid);
      return 'restored';
    } catch {
      return 'partial';
    }
  }

  return 'unsupported';
}
