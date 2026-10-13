// Prueba de empaquetado: npm pack, instalacion limpia y uso real del binario.
// Comprueba que dist, rules y templates viajan en el paquete (spec §18).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const win = process.platform === 'win32';
const npm = (args, cwd) => execFileSync(win ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', shell: win });

const work = mkdtempSync(path.join(tmpdir(), 'hyg-pack-'));
const home = mkdtempSync(path.join(tmpdir(), 'hyg-pack-home-'));
try {
  // npm publish normaliza package.json y puede quitar campos (p. ej. un bin con
  // "./") que npm pack deja intactos: el paquete publicado no tendria binario.
  const dry = spawnSync(win ? 'npm.cmd' : 'npm', ['publish', '--dry-run'], { encoding: 'utf8', shell: win });
  if (/auto-corrected/.test(dry.stderr)) throw new Error(`npm publish corregiria package.json:\n${dry.stderr}`);

  // npm 11 emite un objeto indexado por nombre; versiones anteriores, un array.
  const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', work], process.cwd()));
  const { filename } = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  const app = path.join(work, 'app');
  mkdirSync(app);
  writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'smoke', version: '1.0.0', private: true }));
  npm(['install', '--no-audit', '--no-fund', path.join(work, filename)], app);

  if (!existsSync(path.join(app, 'node_modules', '.bin', win ? 'hygiene.cmd' : 'hygiene'))) {
    throw new Error('el paquete no instala el binario hygiene');
  }
  const bin = path.join(app, 'node_modules', 'project-hygiene', 'dist', 'cli', 'index.js');
  const hygiene = (args) => execFileSync(process.execPath, [bin, ...args], {
    cwd: app, encoding: 'utf8', env: { ...process.env, HYGIENE_HOME: home },
  });

  if (!hygiene(['--help']).includes('Comandos:')) throw new Error('--help no muestra el uso');
  // Como lo usa la gente: por el enlace de node_modules/.bin (en Windows es
  // un .cmd que no se puede lanzar sin shell, asi que solo en POSIX).
  if (!win) {
    const link = path.join(app, 'node_modules', '.bin', 'hygiene');
    const viaLink = execFileSync(link, ['--help'], { cwd: app, encoding: 'utf8' });
    if (!viaLink.includes('Comandos:')) throw new Error('el binario no responde por node_modules/.bin');
  }
  if (!hygiene(['explain', 'FS-TEMP-001']).includes('FS-TEMP-001')) throw new Error('las reglas no viajan en el paquete');
  hygiene(['init', '.']);
  if (!readFileSync(path.join(app, '.gitignore'), 'utf8').includes('node_modules/')) {
    throw new Error('las plantillas no viajan en el paquete');
  }
  console.log('pack-smoke OK');
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
