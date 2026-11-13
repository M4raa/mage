// Frontera IPC de Capacidades (DEVOLUCION-093): solo lectura. Valida con Zod y delega. Solo se leen cuentas de Claude que
// Mage conoce: el renderer no puede pedir que se lea una ruta cualquiera.
import { z } from 'zod';
import type { CapabilitiesOverview } from '@shared/capabilities';
import { IpcChannel } from '@shared/ipc';
import { previewValue } from '../capabilityPackage';

export interface CapabilitiesIpcDeps {
  readonly handle: (channel: string, listener: (event: unknown, arg: unknown) => unknown) => void;
  readonly overview: (accountDir: string) => CapabilitiesOverview;
  readonly claudeAccountDirs: () => readonly string[];
}

// El config dir pedido, solo si es el de una cuenta de Claude conocida.
export function parseClaudeAccountDir(raw: unknown, known: readonly string[]): string {
  const parsed = z.string().min(1).safeParse(raw);
  if (!parsed.success) throw new Error(`Cuenta inválida para Capacidades: ${previewValue(raw)}`);
  if (!known.includes(parsed.data)) throw new Error(`Cuenta de Claude desconocida: ${JSON.stringify(parsed.data)}`);
  return parsed.data;
}

export function registerCapabilitiesIpc(deps: CapabilitiesIpcDeps): void {
  deps.handle(IpcChannel.CapabilitiesOverview, (_event, arg) => deps.overview(parseClaudeAccountDir(arg, deps.claudeAccountDirs())));
}
