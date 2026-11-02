// F2.7 (D1): la comprobación de la bóveda de Mage en un Electron real, con el código de producción empaquetado
// (`vault-gate.mjs`). Mide lo que el usuario vería: cuánto tarda la comprobación, si una cuenta de SUSCRIPCIÓN se da de
// alta y qué pasa al dar de alta una cuenta de API (el error D1 exacto, o la clave guardada y leída de vuelta).
// Solo texto sintético y perfiles desechables; nunca el perfil ni el llavero del usuario.
//
// Entorno: MAGE_VG_PROFILE (userData desechable), MAGE_VG_HOME (HOME desechable de las cuentas), MAGE_VG_BUNDLE.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const SYNTHETIC_KEY = 'sk-sintetica-vault-gate-0000';
const profile = process.env.MAGE_VG_PROFILE;
const home = process.env.MAGE_VG_HOME;
const bundle = process.env.MAGE_VG_BUNDLE;
if (!profile || !home || !bundle) throw new Error('MAGE_VG_PROFILE, MAGE_VG_HOME y MAGE_VG_BUNDLE son obligatorios');
for (const dir of [profile, home]) if (!path.basename(dir).startsWith('mage-vault-gate-')) throw new Error(`Carpeta no desechable: ${dir}`);
app.setPath('userData', profile);
app.disableHardwareAcceleration();
// Lo mismo que hace `index.ts` en Linux sin pantalla, antes de `ready`.
const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
if (headless && !app.commandLine.hasSwitch('password-store')) app.commandLine.appendSwitch('password-store', 'gnome-libsecret');

const { assessVaultForProcess, SecretStore, ProviderAccountService } = require(bundle);
const emit = (value) => console.log(JSON.stringify(value));
const isExecutableFile = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
const files = { exists: fs.existsSync, readFile: (file) => fs.readFileSync(file, 'utf8'), writeFile: (file, data) => fs.writeFileSync(file, data, 'utf8'), rename: fs.renameSync, tempSuffix: () => randomUUID() };

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

app.whenReady().then(async () => {
  const startedAt = Date.now();
  const status = await assessVaultForProcess({ platform: process.platform, env: process.env, cipher: safeStorage, execFile, isExecutableFile,
    readTextFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null), now: Date.now });
  const assessMs = Date.now() - startedAt;
  const store = new SecretStore({ filePath: path.join(profile, 'secrets.json'), cipher: safeStorage, status: () => status, ...files });
  const accounts = new ProviderAccountService({ filePath: path.join(profile, 'provider-accounts.json'), homedir: home, userDataDir: profile, vault: store,
    mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }), rmrf: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    createClaudeDir: () => { throw new Error('La sonda no da de alta cuentas de Claude'); }, deleteClaudeDir: () => undefined, ...files });
  const subscription = attempt(() => accounts.create({ providerId: 'codex', authKind: 'subscription', name: 'suscripcion' }).loginStatus);
  const api = attempt(() => accounts.create({ providerId: 'codex', authKind: 'api-key', name: 'api', apiKey: SYNTHETIC_KEY }).loginStatus);
  const apiKeyBack = api.ok ? attempt(() => accounts.apiKeyFor('codex', path.join(home, '.codex-api')) === SYNTHETIC_KEY) : null;
  emit({
    platform: process.platform, electron: process.versions.electron, passwordStore: app.commandLine.getSwitchValue('password-store') || null,
    backend: typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'n/a',
    assessMs, usable: status.usable, reason: status.usable ? null : status.reason,
    subscription, api, apiKeyBack, apiDirLeft: fs.existsSync(path.join(home, '.codex-api')),
  });
  app.quit();
});
