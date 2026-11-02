// Spike H2 (devolución 15): qué sandbox efectivo da `codex app-server` según los parámetros de `thread/start`.
// SIN turnos: solo el handshake y `thread/start`, que no llama al modelo. Compara los parámetros de R2
// (spike/bench/headless.mjs: `sandbox: 'workspace-write'`) con los de Mage (codexAdapter.afterInitialize: sin
// `sandbox`, con `permissions` solo si el modo de la pestaña es un perfil) en una carpeta SIN confianza.
// Uso: node spike/codex-sandbox-spike.mjs   (CODEX_HOME desechable, sin credenciales; se borra al acabar)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const RPC_TIMEOUT_MS = 30_000;
const MODEL = 'gpt-6-luna';

function codexBinary() {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  return execFileSync(lookup, ['codex'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
}

function client(child) {
  const pending = new Map();
  let seq = 0;
  createInterface({ input: child.stdout }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; } // ruido no JSON del servidor
    if (m.id !== undefined && !m.method) { pending.get(m.id)?.(m); pending.delete(m.id); }
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const rpc = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: { message: `sin respuesta a ${method}` } }); }, RPC_TIMEOUT_MS);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    send({ id, method, params });
  });
  return { rpc, send };
}

// Variantes: lo que manda R2, lo que manda Mage por defecto y lo que mandaría con un perfil de permisos.
const VARIANTS = {
  'R2 (sandbox workspace-write)': (cwd) => ({ cwd, model: MODEL, approvalPolicy: 'on-request', sandbox: 'workspace-write' }),
  'Mage sin modo (sin sandbox ni permissions)': (cwd) => ({ cwd, model: MODEL, approvalPolicy: 'on-request' }),
  'Mage con modo :workspace': (cwd) => ({ cwd, model: MODEL, approvalPolicy: 'on-request', permissions: ':workspace' }),
  'Mage con modo :read-only': (cwd) => ({ cwd, model: MODEL, approvalPolicy: 'on-request', permissions: ':read-only' }),
};

// Solo claves de configuración efectiva: nada de ids, rutas de cuenta ni credenciales.
const pick = (result) => ({ approvalPolicy: result?.approvalPolicy, sandbox: result?.sandbox, permissionProfile: result?.permissionProfile ?? result?.activePermissionProfile });

// Windows suelta el CODEX_HOME unos segundos después de salir el proceso (medido: ~5 s): se reintenta hasta el
// plazo y, pasado, se propaga el último error (nunca se deja el directorio sin avisar).
const REMOVE_DEADLINE_MS = 30_000;
async function removeDir(dir) {
  const deadline = Date.now() + REMOVE_DEADLINE_MS;
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// Dos escenarios: carpeta sin confianza (CODEX_HOME vacío) y carpeta marcada de confianza en su config.toml.
async function measure(scenario, trusted) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-h2-codex-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-h2-codex-cwd-'));
  if (trusted) fs.writeFileSync(path.join(home, 'config.toml'), `[projects.${JSON.stringify(cwd)}]
trust_level = "trusted"
`);
  const child = spawn(codexBinary(), ['app-server'], { cwd, env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: 'pipe' });
  try {
    const c = client(child);
    const init = await c.rpc('initialize', { clientInfo: { name: 'mage-h2', version: '0.1.3' }, capabilities: { experimentalApi: true } });
    if (init.error) throw new Error(`initialize: ${init.error.message}`);
    c.send({ method: 'initialized' });
    console.log(`-- ${scenario}`);
    for (const [name, build] of Object.entries(VARIANTS)) {
      const r = await c.rpc('thread/start', build(cwd));
      console.log(name.padEnd(44), r.error ? `ERROR ${r.error.message}` : JSON.stringify(pick(r.result)));
    }
  } finally {
    child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
    for (const dir of [home, cwd]) await removeDir(dir);
  }
}

await measure('carpeta SIN confianza', false);
await measure('carpeta CON confianza en config.toml', true);
