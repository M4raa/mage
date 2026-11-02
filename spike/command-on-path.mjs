// H2 de la devolución 17: ¿encuentra main los comandos del PATH en una distribución sin `which` (Arch)? Empaqueta
// `src/main/os/commandOnPath.ts` (el código de producción) y, en cada distribución de WSL pedida, compara para una
// lista de comandos lo que respondía el método anterior (`spawnSync('which', [bin])`, el de 62f0e71) con lo que
// responde `isCommandOnPath`. Sin red ni turnos; no escribe nada fuera del temporal.
//
//   node spike/command-on-path.mjs [--distros archlinux,Ubuntu]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), '..');
const args = process.argv.slice(2);
const BINS = ['sh', 'bash', 'ls', 'node', 'git', 'gnome-keyring-daemon', 'claude', 'codex', 'agy', 'gh', 'mage-no-existe'];

// Papel del hijo, dentro de la distribución: imprime una línea JSON por comando.
function measure(bundlePath) {
  const { isCommandOnPath } = createRequire(self)(bundlePath);
  const release = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]*)/m)?.[1] ?? 'desconocida';
  const rows = BINS.map((bin) => {
    const legacy = spawnSync('which', [bin], { stdio: 'ignore', timeout: 5_000 });
    const started = process.hrtime.bigint();
    const found = isCommandOnPath(bin);
    const micros = Number((process.hrtime.bigint() - started) / 1000n);
    return { bin, which: legacy.error?.code ?? (legacy.status === 0), isCommandOnPath: found, micros };
  });
  console.log(JSON.stringify({ release, node: process.version, rows }));
}

function toWsl(winPath) {
  return `/mnt/${winPath[0].toLowerCase()}${winPath.slice(2).replaceAll('\\', '/')}`;
}

function main() {
  if (args[0] === '--child') return measure(args[1]);
  const distros = (args[args.indexOf('--distros') + 1] ?? 'archlinux,Ubuntu').split(',');
  const require = createRequire(path.join(repo, 'package.json'));
  const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-command-on-path-'));
  try {
    const bundle = path.join(dir, 'bundle.cjs');
    esbuild.buildSync({ entryPoints: [path.join(repo, 'src/main/os/commandOnPath.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error' });
    fs.copyFileSync(self, path.join(dir, 'probe.mjs'));
    for (const distro of distros) {
      const result = spawnSync('wsl.exe', ['-d', distro, '--', 'node', toWsl(path.join(dir, 'probe.mjs')), '--child', toWsl(bundle)], { encoding: 'utf8', timeout: 60_000 });
      console.log(JSON.stringify({ distro, exit: result.status, ...(JSON.parse(result.stdout.trim() || '{}')), stderr: result.stderr.trim() || undefined }));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
