// Modo de tareas (F8): tipos compartidos y análisis puro de los bloques que el modelo escribe al terminar.
// Sin dependencias de Node: lo importan main y el renderer.
import { z } from 'zod';

export type TaskProvider = 'claude' | 'codex';
export type TaskLanguage = 'es' | 'en';

export const TASK_LIMITS = { goalMaxChars: 8000, maxFolders: 10, maxDocuments: 20, maxCapabilities: 30, maxDeliverables: 200, maxPathChars: 1024 } as const;
export const TASK_PLAN_FENCE = 'mage-plan';
export const TASK_DELIVERABLES_FENCE = 'mage-deliverables';

export type DeliverableStatus = 'ok' | 'missing' | 'notFile' | 'unreadable' | 'outsideScope';

export interface DeliverableCheck {
  readonly declared: string; // tal como lo escribió el modelo
  readonly path: string; // absoluta, resuelta contra folders[0]
  readonly status: DeliverableStatus;
  readonly bytes: number | null; // entero; null si no es un fichero legible
  readonly modifiedAtMs: number | null;
  readonly kind: string; // extensión en minúsculas sin el punto; '' si no tiene
}

export type TaskVerdict = 'pending' | 'verified' | 'incomplete';

export interface TaskDraft {
  readonly goal: string;
  readonly language: TaskLanguage;
  readonly provider: TaskProvider;
  readonly accountDir: string;
  readonly folders: readonly string[];
  readonly documents: readonly string[];
  readonly capabilities: readonly string[]; // títulos legibles de capacidades instaladas elegidas
}

export interface TaskRecord extends TaskDraft {
  readonly id: string;
  readonly createdAtMs: number;
  readonly sessionId: string | null; // id de sesión de Mage de la última vez que se lanzó
  readonly conversationId: string | null; // Claude: el sessionId nativo; Codex: el id del hilo
  readonly deliverables: readonly DeliverableCheck[];
  readonly verifiedAtMs: number | null;
  readonly verdict: TaskVerdict;
}

export interface TaskPlanStep {
  readonly text: string;
  readonly done: boolean;
}

const MIN_FENCE_TICKS = 3;
const FENCE_LINE = /^(`{3,})(.*?)\s*$/;
const FENCE_CLOSING = /^(`+)\s*$/;
const PLAN_STEP = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/;
const deliverablesSchema = z
  .array(z.string().trim().min(1).max(TASK_LIMITS.maxPathChars))
  .max(TASK_LIMITS.maxDeliverables);

// Nº de acentos graves si la línea abre un bloque con esa etiqueta; null si no.
function fenceOpening(line: string, info: string): number | null {
  const match = FENCE_LINE.exec(line);
  if (match === null || match[2] !== info) return null;
  return (match[1] as string).length;
}

function isFenceClosing(line: string, minTicks: number): boolean {
  const match = FENCE_CLOSING.exec(line);
  return match !== null && (match[1] as string).length >= minTicks;
}

// Contenido (sin las líneas de valla) del ÚLTIMO bloque con esa etiqueta; null si no hay o no cierra.
export function lastFencedBlock(text: string, info: string): string | null {
  const lines = text.split(/\r?\n/);
  let openAt = -1;
  let ticks = MIN_FENCE_TICKS;
  lines.forEach((line, index) => {
    const found = fenceOpening(line, info);
    if (found === null) return;
    openAt = index;
    ticks = found;
  });
  if (openAt < 0) return null;
  const closeAt = lines.findIndex((line, index) => index > openAt && isFenceClosing(line, ticks));
  if (closeAt < 0) return null;
  return lines.slice(openAt + 1, closeAt).join('\n');
}

// Rutas del manifiesto de entregables; null = «no hay manifiesto válido».
export function parseDeliverables(text: string): readonly string[] | null {
  const block = lastFencedBlock(text, TASK_DELIVERABLES_FENCE);
  if (block === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    // Frontera con texto del modelo: el JSON roto ES el resultado «no hay manifiesto válido» (null), no un error silenciado.
    return null;
  }
  const parsed = deliverablesSchema.safeParse(raw);
  return parsed.success ? [...new Set(parsed.data)] : null;
}

export function parsePlan(text: string): readonly TaskPlanStep[] | null {
  const block = lastFencedBlock(text, TASK_PLAN_FENCE);
  if (block === null) return null;
  const steps = block.split('\n').flatMap((line): TaskPlanStep[] => {
    const match = PLAN_STEP.exec(line);
    return match === null ? [] : [{ text: (match[2] as string).trim(), done: match[1] !== ' ' }];
  });
  return steps.length === 0 ? null : steps;
}

export function taskVerdictOf(checks: readonly DeliverableCheck[]): TaskVerdict {
  if (checks.length === 0) return 'incomplete';
  return checks.every((check) => check.status === 'ok') ? 'verified' : 'incomplete';
}
