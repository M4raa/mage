// F0.4: primitivas reales de Electron; no crea BrowserWindow ni carga perfiles reales.
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const profile = process.env.MAGE_F0_PROFILE;
if (!profile) throw new Error('MAGE_F0_PROFILE aislado obligatorio');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const secondary = process.argv.includes('--f0-secondary');
const lock = app.requestSingleInstanceLock();
console.log(JSON.stringify({ phase: 'before-ready', secondary, lock, userDataMatchesProfile: app.getPath('userData') === profile, tempContainsTilde: app.getPath('temp').includes('~'), electron: process.versions.electron }));
if (!lock) app.exit(0);
else app.whenReady().then(() => {
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'not-exposed-on-platform';
  console.log(JSON.stringify({ phase: 'ready', secondary, windowCount: BrowserWindow.getAllWindows().length, encryptionAvailable: safeStorage.isEncryptionAvailable(), backend, dbusPresent: Boolean(process.env.DBUS_SESSION_BUS_ADDRESS), displayPresent: Boolean(process.env.DISPLAY), userDataMatchesProfile: app.getPath('userData') === profile }));
  if (secondary) return app.exit(3);
  const child = spawn(process.execPath, [__filename, '--no-sandbox', '--disable-gpu', '--f0-secondary'], { env: process.env, stdio: ['ignore','pipe','ignore'], windowsHide: true });
  child.stdout.on('data', b => process.stdout.write(b));
  child.on('exit', (code) => { console.log(JSON.stringify({ phase:'secondary-exit', code, windowCount: BrowserWindow.getAllWindows().length })); app.exit(0); });
  setTimeout(() => app.exit(4), 12000);
});
setTimeout(() => app.exit(5), 20000);
