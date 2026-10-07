import { z } from 'zod';

// Frontera del IPC de migración: el renderer solo manda ids y rutas de cuenta; main comprueba además que cada cuenta
// sea de verdad del proveedor que dice y que el id de conversación sea un segmento de ruta seguro.
const PROVIDER = z.enum(['claude', 'codex', 'agy']);
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const MIGRATE_CONVERSATION_SCHEMA = z.object({
  sourceAccountDir: z.string().min(1),
  sourceProvider: PROVIDER,
  sessionId: z.string().regex(SAFE_ID, 'sessionId no valido'),
  cwd: z.string(),
  privacy: z.enum(['shared', 'private']),
  destAccountDir: z.string().min(1),
  destProvider: PROVIDER,
}).strict();
