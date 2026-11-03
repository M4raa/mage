import type { MageEvent, TurnUsage } from '@shared/events';

// Estado de UN keep-alive en vuelo y lo que hay que hacer con cada evento que emite (F4.6). PURO: sin timers ni IO;
// el coordinador ejecuta el paso que se devuelve. Un keep-alive es un turno oculto sin herramientas: cualquier
// permiso se deniega y el primer `tool_use` lo interrumpe.

export interface KeepAliveRun {
  readonly uuid: string; // uuid del mensaje oculto: es el objetivo de su rewind
  readonly interrupted: boolean;
}

export type KeepAliveStep =
  | { readonly kind: 'ignore' } // evento consumido, sin accion
  | { readonly kind: 'deny_permission'; readonly requestId: string }
  | { readonly kind: 'interrupt' } // primer tool_use: se corta (una vez)
  | { readonly kind: 'finish'; readonly usage: TurnUsage | null; readonly costMicroUsd: number | null } // `result`
  | { readonly kind: 'abort' }; // session_restarting o error: el keep-alive murio

const IGNORE: KeepAliveStep = { kind: 'ignore' };

export function keepAliveStep(run: KeepAliveRun, event: MageEvent): { readonly step: KeepAliveStep; readonly run: KeepAliveRun } {
  switch (event.kind) {
    case 'permission_request':
      return { step: { kind: 'deny_permission', requestId: event.request.requestId }, run };
    case 'tool_use':
      return run.interrupted ? { step: IGNORE, run } : { step: { kind: 'interrupt' }, run: { ...run, interrupted: true } };
    case 'result':
      return { step: { kind: 'finish', usage: event.result.usage ?? null, costMicroUsd: event.result.costMicroUsd ?? null }, run };
    case 'session_restarting':
    case 'error':
      return { step: { kind: 'abort' }, run };
    default:
      return { step: IGNORE, run };
  }
}
