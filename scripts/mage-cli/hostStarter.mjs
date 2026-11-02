// Encontrar el host de Mage del perfil o arrancar Mage sin ventanas (F7): con plazo y diagnóstico claro. Puro:
// conectar, lanzar, esperar y el reloj llegan por parámetro.

export const HOST_START_TIMEOUT_MS = 20_000;
export const HOST_POLL_MS = 250;

const NO_HOST_CODES = new Set(['ENOENT', 'ECONNREFUSED']);

// Faltan los ficheros del host, el pipe no existe o el socket quedó de una caída. Un impostor
// (`NOT_MAGE_SERVER`) o cualquier otro error NO cuenta: nunca se arranca Mage por él.
export function isNoHostError(error) {
  return NO_HOST_CODES.has(error?.code) || NO_HOST_CODES.has(error?.cause?.code);
}

export function headlessLaunch({ platform, execPath, isElectron, env, userDataDir, defaultUserDataDir }) {
  if (!isElectron) {
    throw new Error('No sé arrancar Mage desde aquí: usa el lanzador «mage» instalado con Mage, o abre Mage y vuelve a intentarlo');
  }
  const args = ['--headless'];
  if (platform === 'linux') args.push('--ozone-platform=headless');
  if (userDataDir !== defaultUserDataDir) args.push(`--user-data-dir=${userDataDir}`);
  // El AppImage se monta temporalmente: su binario interno desaparece al salir el proceso que lo lanzó.
  const command = typeof env.APPIMAGE === 'string' && env.APPIMAGE !== '' ? env.APPIMAGE : execPath;
  // ELECTRON_RUN_AS_NODE se hereda: con ella el «Mage» que se arranca sería otro Node y no habría host.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...cleanEnv } = env;
  return { command, args, env: cleanEnv };
}

async function waitForHost({ connect, sleep, now, timeoutMs, pollMs }) {
  const start = now();
  for (;;) {
    await sleep(pollMs);
    try {
      return await connect();
    } catch (error) {
      if (!isNoHostError(error)) throw error;
    }
    if (now() - start >= timeoutMs) {
      throw new Error(`Mage no respondió en ${timeoutMs / 1000} s tras arrancarlo sin ventanas. Si ya tenías Mage abierto con este perfil, mira si su ventana avisa de que el host local no arrancó; si no, abre Mage normalmente para ver el motivo.`);
    }
  }
}

export async function ensureHost({ connect, launch, sleep, now, allowStart, onStarting, timeoutMs = HOST_START_TIMEOUT_MS, pollMs = HOST_POLL_MS }) {
  try {
    return { link: await connect(), started: false };
  } catch (error) {
    if (!isNoHostError(error) || !allowStart) throw error;
  }
  launch();
  onStarting();
  const link = await waitForHost({ connect, sleep, now, timeoutMs, pollMs });
  return { link, started: true };
}
