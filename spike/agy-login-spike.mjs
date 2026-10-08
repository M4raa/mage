// Mide cómo se completa el login de agy en un perfil aislado, SIN iniciar sesión de verdad: arranca agy con un
// USERPROFILE vacío y SSH_CONNECTION (guarda el token en el perfil), imprime lo que dice y prueba si lee un código
// por la entrada estándar (se manda uno inventado: el CLI debería rechazarlo). Uso: node spike/agy-login-spike.mjs [--tui]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = mkdtempSync(join(tmpdir(), 'mage-agy-login-'));
const env = { ...process.env, USERPROFILE: profile, SSH_CONNECTION: '1.1.1.1 22 2.2.2.2 22' };
const args = ['--print', '/usage', ...(process.argv.includes('--long') ? ['--print-timeout', '10m'] : [])];
const child = spawn('agy', args, { cwd: profile, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let out = '';
const seen = [];
const onData = (chunk) => { const text = chunk.toString(); out += text; seen.push(text.replace(/https:\/\/accounts\.google\.com\S+/g, '<URL-DE-LOGIN>').trim()); };
child.stdout.on('data', onData);
child.stderr.on('data', onData);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  for (let i = 0; i < 40 && !out.includes('Waiting for authentication'); i += 1) await wait(250);
  console.log('1) salida inicial:', JSON.stringify(seen.join(' | ')).slice(0, 400));
  child.stdin.write('codigo-inventado-1234\n');
  await wait(4000);
  console.log('2) tras mandar un código inventado por stdin:', JSON.stringify(seen.slice(1).join(' | ')).slice(0, 500));
  console.log('   ¿sigue vivo el proceso?', child.exitCode === null);
} finally {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  await wait(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
