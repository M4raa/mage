// Cómo abre fuera un enlace del chat. Es un objeto (no una función suelta) para que verify:gui sustituya `external` a través de
// `__mageDev` (devBridge.ts) y no abra el navegador del sistema. En producción, siempre el IPC (con la guarda https de main).
export const linkOpener: { external: (url: string) => Promise<void> } = { external: (url) => window.mage.openExternal(url) };
