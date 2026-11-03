// Tiempo propio de los tests que lanzan procesos git REALES (worktreeService*.test.ts): unos 25 por test.
// Medido en Windows (carril T, 0.1.4) el más lento: 0,7 s en solitario, 3,1 s con otra suite a la vez y
// 8,1 s con cuatro. Los 5 s por defecto de Vitest no cubren la máquina cargada; 20 s dejan ~2,5× de margen
// sobre el peor caso medido.
export const GIT_REAL_TIMEOUT_MS = 20_000;
