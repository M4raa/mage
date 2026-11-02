// Preferencias y nombre de partición del navegador aislado (I3).
// Sin preload, sin Node, en sandbox y con aislamiento de contexto; partición EN MEMORIA (nunca `persist:`), una por instancia.

// SIN `preload`, a propósito: la página no ve nada de Mage.
export const ISOLATED_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
} as const);

export const BROWSER_PARTITION_PREFIX = 'mage-browser-';

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Devuelve el nombre de partición de una instancia del navegador.
 * Sin el prefijo `persist:`, Electron la crea en memoria (medido en I1: `isPersistent()` → false).
 */
export function partitionNameFor(instanceId: string): string {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new Error(`Id de instancia del navegador no válido: «${instanceId}»`);
  }
  return `${BROWSER_PARTITION_PREFIX}${instanceId}`;
}
