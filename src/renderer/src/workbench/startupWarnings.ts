import type { StartupWarning } from '@shared/ipc';
import type { NotifyInput } from './notifications';

// Avisos de inicio de main (F2.6, D-AppImage): se enseñan PERSISTENTES (hasta la ✕) y una sola vez por id, aunque
// la ventana recargue. Si main no responde, el fallo se ve como cualquier otra acción fallida.
export interface StartupWarningsDeps {
  readonly fetchWarnings: () => Promise<readonly StartupWarning[]>;
  readonly notify: (input: NotifyInput) => unknown;
  readonly reportError: (title: string, err: unknown, source: string) => void;
}

export async function showStartupWarnings({ fetchWarnings, notify, reportError }: StartupWarningsDeps): Promise<void> {
  let warnings: readonly StartupWarning[];
  try {
    warnings = await fetchWarnings();
  } catch (err) {
    reportError('No se pudieron leer los avisos de inicio', err, 'startup');
    return;
  }
  for (const warning of warnings) {
    notify({ level: 'warning', title: warning.title, body: warning.body, timeoutMs: null, dedupeKey: `startup:${warning.id}`, source: 'startup' });
  }
}
