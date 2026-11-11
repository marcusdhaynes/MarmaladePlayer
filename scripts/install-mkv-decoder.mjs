// Install the pinned, on-demand decoder in every native and web package.
// Only copies the published package's built files; no media is ever uploaded.
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const installDir = join(root, '.marmalade-decoder-install');
const destination = join(root, 'vendor', 'libav-wasm');
const version = '0.8.14';

if (existsSync(join(destination, 'index.js')) &&
    existsSync(join(destination, 'worker.js')) &&
    existsSync(join(destination, 'libav.wasm')) &&
    existsSync(join(destination, 'libav-jspi.wasm'))) {
  console.log('Using already-installed MKV decoder assets.');
  process.exit(0);
}
rmSync(installDir, { recursive: true, force: true });
mkdirSync(installDir, { recursive: true });
try {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save',
      '--prefix', installDir, 'libav-wasm@' + version],
    { stdio: 'inherit', timeout: 180000 });
  const source = join(installDir, 'node_modules', 'libav-wasm', 'build');
  for (const asset of ['index.js', 'worker.js', 'libav.wasm', 'libav-jspi.wasm']) {
    if (!existsSync(join(source, asset)))
      throw new Error('Pinned decoder package is missing ' + asset);
  }
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(resolve(destination, '..'), { recursive: true });
  cpSync(source, destination, { recursive: true });
  console.log('Installed streaming MKV decoder '+version, readdirSync(destination).join(', '));
} finally {
  rmSync(installDir, { recursive: true, force: true });
}
