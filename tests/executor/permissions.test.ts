import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, chmod, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capturePermissions, applyPermissions } from '../../src/executor/permissions.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'hyg-perm-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('permisos', () => {
  it.runIf(process.platform !== 'win32')('captura y restaura el modo POSIX', async () => {
    const p = path.join(dir, 'a.log');
    await writeFile(p, 'x');
    await chmod(p, 0o640);

    const perms = await capturePermissions(p, dir);
    expect(perms).toMatchObject({ model: 'posix', captured: true, data: { mode: 0o640 } });

    await chmod(p, 0o600);
    expect(await applyPermissions(p, dir, perms)).toBe('restored');
    expect((await stat(p)).mode & 0o777).toBe(0o640);
  });

  it.runIf(process.platform === 'win32')('captura la ACL con icacls y la restaura', async () => {
    const p = path.join(dir, 'a.log');
    await writeFile(p, 'x');

    const perms = await capturePermissions(p, dir);
    expect(perms).toEqual({ model: 'acl', captured: true, data: { aclFile: 'acl.txt' } });
    expect(await access(path.join(dir, 'acl.txt')).then(() => true, () => false)).toBe(true);
    expect(await applyPermissions(p, dir, perms)).toBe('restored');
  });

  it('en una plataforma sin soporte no finge exito', async () => {
    const p = path.join(dir, 'a.log');
    await writeFile(p, 'x');
    const perms = await capturePermissions(p, dir, 'aix');
    expect(perms).toEqual({ model: 'none', captured: false, data: null });
    expect(await applyPermissions(p, dir, perms)).toBe('unsupported');
  });
});
