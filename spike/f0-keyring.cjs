// F0.5c: una primitiva síncrona por proceso; el supervisor externo impone el plazo real.
// Solo texto y bóveda desechables. Nunca ejecutar sobre un HOME/perfil del usuario.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
// performance.now() parte del arranque del proceso Node/Electron, no de cargar este fichero.
const began = 0;
const emit = (value) => console.log(JSON.stringify(value));
const profile = process.env.MAGE_F0_PROFILE;
const action = process.env.MAGE_F0_ACTION;
if (!profile || !action) throw new Error('MAGE_F0_PROFILE y MAGE_F0_ACTION son obligatorios');
if (process.getuid() === 0 || app.commandLine.hasSwitch('no-sandbox')) throw new Error('Usuario no privilegiado y sandbox obligatorios');
app.setPath('userData', profile);
app.disableHardwareAcceleration();
emit({ phase: 'start', uid: process.getuid(), action, electron: process.versions.electron,
  ozone: app.commandLine.getSwitchValue('ozone-platform'), passwordStore: app.commandLine.getSwitchValue('password-store'),
  noSandbox: app.commandLine.hasSwitch('no-sandbox'), display: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) });
function measure(name, callback) {
  const start = performance.now();
  emit({ phase: 'call-start', name, elapsedMs: start - began });
  try {
    const result = callback();
    emit({ phase: 'call-end', name, durationMs: performance.now() - start, result });
  }
  catch (error) { emit({ phase: 'call-error', name, durationMs: performance.now() - start, message: error.message }); }
}
app.whenReady().then(() => {
  emit({ phase: 'ready', readyMs: performance.now() - began, isolated: app.getPath('userData') === profile });
  measure('backend', () => safeStorage.getSelectedStorageBackend());
  if (action === 'availability') measure(action, () => safeStorage.isEncryptionAvailable());
  else if (action === 'encrypt') measure(action, () => safeStorage.encryptString('F0.5c synthetic fixture').length);
  else if (action === 'decrypt') measure(action, () => safeStorage.decryptString(fs.readFileSync(process.env.MAGE_F0_CIPHER)) === 'F0.5c synthetic fixture');
  else if (action === 'fixture') measure(action, () => {
    const cipher = safeStorage.encryptString('F0.5c synthetic fixture');
    fs.writeFileSync(process.env.MAGE_F0_CIPHER, cipher, { mode: 0o600 });
    return safeStorage.decryptString(cipher) === 'F0.5c synthetic fixture';
  });
  else if (action === 'warm-lock') {
    const cipher = safeStorage.encryptString('F0.5c synthetic fixture');
    execFileSync('dbus-send', ['--session', '--print-reply', '--reply-timeout=1500',
      '--dest=org.freedesktop.secrets', '/org/freedesktop/secrets', 'org.freedesktop.Secret.Service.Lock',
      'array:objpath:' + process.env.MAGE_F0_COLLECTION], { timeout: 2000 });
    measure('cached-availability', () => safeStorage.isEncryptionAvailable());
    measure('cached-encrypt', () => safeStorage.encryptString('F0.5c synthetic fixture').length);
    measure('cached-decrypt', () => safeStorage.decryptString(cipher) === 'F0.5c synthetic fixture');
  }
  else throw new Error(`Acción desconocida: ${action}`);
  app.exit(0);
});
