// F2.7, paso previo (devolución 16): ¿una bóveda escrita por una versión anterior de Mage la sigue leyendo la
// actual? Una acción por proceso, como hace la app de verdad: un proceso escribe con la implementación vieja de
// `SecretStore` y otro lee con la nueva. Solo texto y perfil desechables; nunca un perfil ni un llavero del usuario.
//
// Entorno: MAGE_VC_PROFILE (userData desechable), MAGE_VC_IMPL (bundle CJS de un `secretStore.ts`),
// MAGE_VC_ACTION (`write` | `read`). La bóveda es `<perfil>/secrets.json`, el mismo nombre que usa main.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Texto sintético: lo único que se cifra. No sale nunca por la salida; solo si coincide.
const SYNTHETIC = 'mage vault-compat sintetico 2026';
const SECRET_ID = 'vault-compat:sintetico';

const profile = process.env.MAGE_VC_PROFILE;
const impl = process.env.MAGE_VC_IMPL;
const action = process.env.MAGE_VC_ACTION;
if (!profile || !impl || !action) throw new Error('MAGE_VC_PROFILE, MAGE_VC_IMPL y MAGE_VC_ACTION son obligatorios');
if (!path.basename(profile).startsWith('mage-vault-compat-')) throw new Error(`Perfil no desechable: ${profile}`);
app.setPath('userData', profile);
app.disableHardwareAcceleration();

const emit = (value) => console.log(JSON.stringify(value));

function storeFor(SecretStore) {
  return new SecretStore({
    filePath: path.join(profile, 'secrets.json'),
    cipher: safeStorage,
    exists: fs.existsSync,
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    writeFile: (file, data) => fs.writeFileSync(file, data, 'utf8'),
    rename: fs.renameSync,
    tempSuffix: () => randomUUID(),
  });
}

function run(store) {
  if (action === 'write') {
    store.set(SECRET_ID, SYNTHETIC);
    return { written: fs.existsSync(path.join(profile, 'secrets.json')) };
  }
  if (action === 'read') return { matches: store.get(SECRET_ID) === SYNTHETIC };
  throw new Error(`Acción desconocida: ${action}`);
}

app.whenReady().then(() => {
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'n/a';
  const base = { action, impl: path.basename(impl), platform: process.platform, electron: process.versions.electron,
    passwordStore: app.commandLine.getSwitchValue('password-store') || null, backend, available: safeStorage.isEncryptionAvailable() };
  try {
    emit({ ...base, ok: true, ...run(storeFor(require(impl).SecretStore)) });
  } catch (err) {
    emit({ ...base, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  // `quit` y no `exit`: Chromium guarda la clave de cifrado (en Windows, en `Local State`, protegida con DPAPI) al
  // cerrar ordenadamente. Con `exit` no se guarda y ni siquiera la misma versión lee lo que escribió.
  app.quit();
});
