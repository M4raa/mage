import { z } from 'zod';
import type { NotifyParams } from '@shared/ipc';

// Frontera del IPC `NotifyShow`: lo que manda el renderer se valida antes de llegar al SO. Estricto (sin
// campos libres): lo que no es titulo, cuerpo o destino del clic no tiene por que viajar.
const notificationTargetSchema = z
  .object({
    tabId: z.string().min(1).optional(),
    sessionId: z.string().min(1),
    opensActivity: z.boolean().optional(),
  })
  .strict();

const notifyParamsSchema = z
  .object({
    title: z.string().min(1),
    body: z.string(),
    target: notificationTargetSchema.optional(),
  })
  .strict();

export function parseNotifyParams(raw: unknown): NotifyParams {
  const parsed = notifyParamsSchema.safeParse(raw);
  if (!parsed.success) {
    // Solo los caminos y los mensajes: el payload puede traer texto del usuario y no se vuelca entero.
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`).join('; ');
    throw new Error(`NotifyShow: parametros invalidos (${issues})`);
  }
  return parsed.data;
}
