// Deteccion de plataforma para resolver `CmdOrCtrl` (D5 §6). `navigator.platform` esta deprecado en el
// estandar web pero sigue disponible en el renderer de Electron (Chromium) y basta para esto: solo hace
// falta distinguir "es mac o no", nunca se guarda ni se muestra literal (§2 del catalogo).
export function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes('mac');
}

// Windows: sus rutas no distinguen mayusculas (agrupar carpetas del historial, P-028 16).
export function isWindowsPlatform(): boolean {
  // Guardado: los tests del store corren en Node, donde `navigator.platform` puede no existir.
  return globalThis.navigator?.platform?.toLowerCase().startsWith('win') ?? false;
}
