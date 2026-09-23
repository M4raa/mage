import { createHash } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { isArtifactUrl } from '@shared/artifacts';

// Ventana de artifact (2.4), con la plantilla de `oauthWindow.ts` y dos guardas mas que aquella no
// necesita. Lo que resuelve: un artifact publicado con la cuenta A tiene que abrirse CON LA CUENTA A,
// aunque la conversacion se este mirando desde la cuenta B — y en un navegador normal eso no se puede,
// porque las dos cuentas comparten cookies de claude.ai.
//
// De ahi la `partition` PROPIA POR CUENTA: cada una recuerda su sesion de claude.ai por separado. Es
// persistente a proposito (si no, habria que iniciar sesion en cada apertura).
//
// AVISO DE SEGURIDAD, el mismo que la ventana OAuth: la CSP de Mage se inyecta SOLO en
// `session.defaultSession`, asi que una partition propia queda FUERA de ella. Es inevitable (hay que
// cargar claude.ai) y se compensa con: sin preload, `sandbox: true`, `contextIsolation: true`, popups
// denegados y —esto si es nuevo— una guarda de navegacion que CANCELA cualquier salto fuera de
// claude.ai. Si algun dia la CSP se aplica globalmente, hay que exceptuar ESTA partition tambien.

const ARTIFACT_WINDOW = { width: 1100, height: 820 } as const;

// Host unico permitido dentro de la ventana. Un artifact enlaza a claude.ai; cualquier otro salto
// (publicidad, un enlace del propio documento) se cancela y se queda donde estaba.
const ALLOWED_HOST = 'claude.ai';

// Ventanas abiertas por URL: reabrir el mismo artifact ENFOCA la que ya hay en vez de acumular veinte.
const openWindows = new Map<string, BrowserWindow>();

// Nombre de partition para una cuenta. El config dir es una ruta (`C:\Users\…\.claude-p`), con
// separadores y dos puntos: no vale como nombre de partition. Se deriva de un hash ESTABLE: si el hash
// cambiara, el usuario tendria que volver a iniciar sesion en todas sus cuentas.
export function partitionForAccount(accountDir: string): string {
  if (accountDir.trim().length === 0) {
    throw new Error(`Config dir vacio al resolver la partition del artifact: ${JSON.stringify(accountDir)}`);
  }
  const hash = createHash('sha256').update(accountDir).digest('hex').slice(0, 16);
  return `persist:mage-artifact-${hash}`;
}

// Abre (o enfoca) la ventana de un artifact con la sesion de `accountDir`. La URL se valida ANTES de
// abrir nada: una que no case el patron es un error de programacion o un dato corrupto, y lanza con el
// valor recibido en vez de abrir una ventana con la sesion de la cuenta en un sitio ajeno.
export function openArtifactWindow(url: string, accountDir: string): void {
  if (!isArtifactUrl(url)) {
    throw new Error(`URL de artifact invalida: ${JSON.stringify(url)}`);
  }
  const existing = openWindows.get(url);
  if (existing !== undefined && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }

  const window = new BrowserWindow({
    width: ARTIFACT_WINDOW.width,
    height: ARTIFACT_WINDOW.height,
    title: 'Artifact — Mage',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: partitionForAccount(accountDir),
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (!isSameHost(target, ALLOWED_HOST)) event.preventDefault();
  });
  window.on('closed', () => openWindows.delete(url));
  openWindows.set(url, window);
  void window.loadURL(url);
}

// Comparacion por HOST parseado, nunca por `startsWith`: `https://claude.ai.evil.com/x` empieza por
// `https://claude.ai` y no es claude.ai.
function isSameHost(url: string, host: string): boolean {
  try {
    return new URL(url).host === host;
  } catch {
    return false; // URL no parseable: no se navega
  }
}
