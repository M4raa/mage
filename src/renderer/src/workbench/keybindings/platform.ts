// Deteccion de plataforma para resolver `CmdOrCtrl` (D5 §6). `navigator.platform` esta deprecado en el
// estandar web pero sigue disponible en el renderer de Electron (Chromium) y basta para esto: solo hace
// falta distinguir "es mac o no", nunca se guarda ni se muestra literal (§2 del catalogo).
export function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes('mac');
}
