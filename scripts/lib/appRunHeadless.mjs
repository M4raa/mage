// AppRun propio del AppImage: el que genera app-builder-lib MAS `--ozone-platform=headless` cuando no hay pantalla.
// Sin X ni Wayland, Chromium muere antes del JS de main (código 133, «Missing X server»), así que el flag tiene que
// ir en la línea de comandos. `electron-builder.yml` (linux.extraFiles) copia el resultado a la raíz de la app y
// sustituye al AppRun generado. Regenerar con: node scripts/lib/appRunHeadless.mjs --write
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_RUN_PATH = path.join(REPO_ROOT, 'resources', 'bin', 'AppRun');

// Sin EULA: Mage no declara `license` en electron-builder.yml.
export const APP_RUN_CONFIG = { ExecutableName: 'mage', ProductName: 'Mage', ProductFilename: 'Mage' };

export const HEADLESS_BLOCK = `# Mage: sin pantalla (ni DISPLAY ni WAYLAND_DISPLAY) Chromium muere antes de arrancar (133, «Missing X server»). El relevo
# \`--cli\` y el host sin ventanas necesitan ozone headless. No se añade en modo Node ni si ya viene un --ozone-platform.
HEADLESS=()
if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ] && [ -z "$ELECTRON_RUN_AS_NODE" ] ; then
  HEADLESS=(--ozone-platform=headless)
  for arg in "\${args[@]}" ; do
    case "$arg" in --ozone-platform=*) HEADLESS=() ; break ;; esac
  done
fi
`;

const ATEXIT_ANCHOR = '\natexit()\n';
const EXEC_PLAIN = 'exec "$BIN" "${NO_SANDBOX[@]}"\n';
const EXEC_ARGS = 'exec "$BIN" "${NO_SANDBOX[@]}" "${args[@]}"\n';

// Sustituye `anchor` por `replacement` exigiendo que aparezca EXACTAMENTE una vez.
function replaceOnce(script, anchor, replacement) {
  const count = script.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`AppRun de app-builder-lib cambió: no encuentro ${JSON.stringify(anchor.trim())} (apariciones: ${count})`);
  }
  return script.replace(anchor, () => replacement);
}

export function withHeadlessOzone(script) {
  let result = replaceOnce(script, ATEXIT_ANCHOR, `\n${HEADLESS_BLOCK}\natexit()\n`);
  result = replaceOnce(result, EXEC_PLAIN, 'exec "$BIN" "${NO_SANDBOX[@]}" "${HEADLESS[@]}"\n');
  return replaceOnce(result, EXEC_ARGS, 'exec "$BIN" "${NO_SANDBOX[@]}" "${HEADLESS[@]}" "${args[@]}"\n');
}

// app-builder-lib es dependencia transitiva de electron-builder: se resuelve desde él.
export function expectedAppRun() {
  const fromBuilder = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
  const { generateAppRunScript } = fromBuilder('app-builder-lib/out/targets/appimage/appImageUtil.js');
  return withHeadlessOzone(generateAppRunScript(APP_RUN_CONFIG));
}

if (process.argv.includes('--write') && process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(APP_RUN_PATH, expectedAppRun().replace(/\r\n/g, '\n'));
  console.log(`[appRun] escrito ${APP_RUN_PATH}`);
}
