// Avisos de COSTE al cambiar de modelo o de nivel de esfuerzo en caliente (M2.4, feedback GUI B1).
// Modulo PURO (datos -> datos): la UI solo pinta el mensaje que devuelve. No hay precios aqui —
// Mage consume SUSCRIPCION, no API: lo que importa es cuanto muerde cada opcion de la bolsa de uso.

import { EFFORT_LEVELS } from '@shared/ipc';

// Peso relativo de consumo de cada familia de modelos de Claude (mayor = agota antes la bolsa).
// Se compara por FAMILIA (el sufijo [1m] no cambia de familia, pero si encarece por contexto).
const MODEL_WEIGHT: Readonly<Record<string, number>> = { haiku: 1, sonnet: 2, opus: 3 };

// Etiqueta legible de una familia (para el texto del aviso).
const FAMILY_LABEL: Readonly<Record<string, string>> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };

export type AdviceSeverity = 'info' | 'warn';

export interface CostAdvice {
  readonly severity: AdviceSeverity;
  readonly message: string;
}

// Familia de un id de modelo del CLI ('opus[1m]' -> 'opus'). null si no se reconoce (modelo custom).
export function modelFamily(modelId: string): string | null {
  const lower = modelId.trim().toLowerCase();
  for (const family of Object.keys(MODEL_WEIGHT)) {
    if (lower.includes(family)) return family;
  }
  return null;
}

// ¿El id pide la ventana de 1M de contexto? (encarece cada turno: mas contexto = mas tokens de entrada)
export function isLongContext(modelId: string): boolean {
  return modelId.trim().toLowerCase().includes('[1m]');
}

// Aviso al cambiar de modelo. null si no hay nada que decir (mismo modelo, o cambio a algo mas barato
// y sin ventana larga). No inventa cifras: describe la direccion del cambio.
export function modelChangeAdvice(from: string, to: string): CostAdvice | null {
  if (from.trim() === to.trim()) return null;
  const fromWeight = weightOf(from);
  const toWeight = weightOf(to);
  const toLabel = labelOf(to);

  if (fromWeight !== null && toWeight !== null && toWeight > fromWeight) {
    return {
      severity: 'warn',
      message: `${toLabel} consume tu bolsa de uso bastante más rápido que ${labelOf(from)}. Aplica al siguiente turno.`,
    };
  }
  const longContext = isLongContext(to) && !isLongContext(from);
  if (longContext) {
    return {
      severity: 'warn',
      message: `La ventana de 1M de contexto encarece cada turno (más tokens de entrada). Aplica al siguiente turno.`,
    };
  }
  return { severity: 'info', message: `Modelo cambiado a ${toLabel}. Aplica al siguiente turno.` };
}

// Peso de consumo de un id de modelo (null si la familia no se reconoce).
function weightOf(modelId: string): number | null {
  const family = modelFamily(modelId);
  return family === null ? null : (MODEL_WEIGHT[family] ?? null);
}

// Etiqueta para el aviso: nombre de familia si se reconoce, o el id tal cual.
function labelOf(modelId: string): string {
  const family = modelFamily(modelId);
  return family === null ? modelId.trim() : (FAMILY_LABEL[family] ?? modelId.trim());
}

// Aviso al cambiar el nivel de esfuerzo. Los niveles altos razonan mas -> mas tokens de salida.
// `sessionLive` cambia el mensaje: --effort es un flag de arranque, no se puede cambiar en caliente.
export function effortChangeAdvice(level: string, sessionLive: boolean): CostAdvice | null {
  const clean = level.trim().toLowerCase();
  const levels = EFFORT_LEVELS as readonly string[];
  if (clean.length > 0 && !levels.includes(clean)) {
    throw new Error(`Nivel de esfuerzo desconocido: ${JSON.stringify(level)}`);
  }
  const suffix = sessionLive
    ? ' Se aplicará al reabrir esta conversación (es un parámetro de arranque del CLI).'
    : ' Se aplicará al arrancar la sesión.';
  if (clean.length === 0) return { severity: 'info', message: `Esfuerzo por defecto del CLI.${suffix}` };
  const index = levels.indexOf(clean);
  const severity: AdviceSeverity = index >= levels.indexOf('xhigh') ? 'warn' : 'info';
  const body =
    severity === 'warn'
      ? `Esfuerzo "${clean}": el modelo razona mucho más y gasta bastantes más tokens.`
      : `Esfuerzo "${clean}".`;
  return { severity, message: `${body}${suffix}` };
}
