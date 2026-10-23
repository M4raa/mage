// F0.5b: primitivas Electron, sin cuentas/proveedor; ejecutar mediante host-matrix.sh (evidencias006).
// Perfiles y copia ejecutable fuera del repo. El hijo hereda EXACTAMENTE la política de sandbox.
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const method = process.env.MAGE_PASSWORD_METHOD;
if (method === 'append') app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
const profile = process.env.MAGE_F0_PROFILE;
if (!profile) throw new Error('Perfil temporal explícito obligatorio');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const secondary = process.argv.includes('--f0-secondary');
const noSandbox = app.commandLine.hasSwitch('no-sandbox');
const flags = ['--disable-gpu'];
if (noSandbox) flags.push('--no-sandbox');
const ozone = app.commandLine.getSwitchValue('ozone-platform');
if (ozone) flags.push('--ozone-platform=' + ozone);
if (method === 'argv') flags.push('--password-store=gnome-libsecret');
const lock = app.requestSingleInstanceLock();
console.log(JSON.stringify({ phase: 'before-ready', uid: process.getuid(), secondary, lock,
  electron: process.versions.electron, node: process.versions.node, noSandbox, disableGpu: app.commandLine.hasSwitch('disable-gpu'),
  ozone, passwordMethod: method, passwordSwitch: app.commandLine.getSwitchValue('password-store'),
  userDataIsolated: app.getPath('userData') === profile, display: Boolean(process.env.DISPLAY), wayland: Boolean(process.env.WAYLAND_DISPLAY), desktop: process.env.XDG_CURRENT_DESKTOP ?? null }));
if (!lock) app.exit(0);
else app.whenReady().then(async () => {
  console.log(JSON.stringify({ phase: 'ready', uid: process.getuid(), noSandbox,
    windows: BrowserWindow.getAllWindows().length, userDataIsolated: app.getPath('userData') === profile,
    backend: safeStorage.getSelectedStorageBackend(), encryptionAvailable: safeStorage.isEncryptionAvailable() }));
  if (process.env.MAGE_TRY_WINDOW === '1') {
    try {
      console.log(JSON.stringify({ phase: 'before-window-constructor' }));
      const win = new BrowserWindow({ show: false, width: 240, height: 120, webPreferences: { sandbox: true } });
      console.log(JSON.stringify({ phase: 'after-window-constructor' }));
      win.webContents.on('render-process-gone', (_event, details) => console.log(JSON.stringify({ phase: 'renderer-gone', reason: details.reason, exitCode: details.exitCode })));
      await win.loadURL('data:text/html,<title>F0.5b fixture</title><p>synthetic</p>');
      win.show();
      console.log(JSON.stringify({ phase: 'window', count: BrowserWindow.getAllWindows().length,
        logicalVisible: win.isVisible(), titleMatches: win.getTitle() === 'F0.5b fixture', display: Boolean(process.env.DISPLAY),
        note: 'logicalVisible no demuestra una superficie visible en un escritorio' }));
      win.destroy();
      // El control de ventana termina aquí; no dejar un hijo arrancando mientras se retira la copia.
      return app.exit(0);
    } catch (error) {
      console.log(JSON.stringify({ phase: 'window-error', name: error.name, message: error.message.slice(0, 200) }));
    }
  }
  const child = spawn(process.execPath, [...flags, __filename, '--f0-secondary'], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.on('error', () => app.exit(6));
  child.on('exit', code => { console.log(JSON.stringify({ phase: 'secondary-exit', code })); app.exit(code === 0 ? 0 : 7); });
});
setTimeout(() => app.exit(8), 15000);
