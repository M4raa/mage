// Frontera IPC de Capacidades. Valida con Zod y delega. Solo se tocan cuentas de Claude que
// Mage conoce: el renderer no puede pedir que se lea ni se ejecute nada en una ruta cualquiera.
import { z } from 'zod';
import type { CapabilitiesOverview, PluginActionParams, PluginCatalogView } from '@shared/capabilities';
import { IpcChannel } from '@shared/ipc';
import { describeIssues, NATIVE_NAME, previewValue } from '../capabilityPackage';
import { pluginActionCommand, type NativeCommand } from '../nativeCommands';

export interface CapabilitiesIpcDeps {
  readonly handle: (channel: string, listener: (event: unknown, arg: unknown) => unknown) => void;
  readonly overview: (accountDir: string) => CapabilitiesOverview;
  readonly claudeAccountDirs: () => readonly string[];
  readonly pluginCatalog: (accountDir: string) => PluginCatalogView;
  readonly runPluginCommand: (accountDir: string, command: NativeCommand) => Promise<void>;
}

// El config dir pedido, solo si es el de una cuenta de Claude conocida.
export function parseClaudeAccountDir(raw: unknown, known: readonly string[]): string {
  const parsed = z.string().min(1).safeParse(raw);
  if (!parsed.success) throw new Error(`Cuenta inválida para Capacidades: ${previewValue(raw)}`);
  if (!known.includes(parsed.data)) throw new Error(`Cuenta de Claude desconocida: ${JSON.stringify(parsed.data)}`);
  return parsed.data;
}

const PLUGIN_ACTION = z.object({
  accountDir: z.string().min(1),
  action: z.enum(['install', 'uninstall', 'enable', 'disable']),
  plugin: z.string().regex(NATIVE_NAME),
  marketplace: z.string().regex(NATIVE_NAME),
});

export function parsePluginActionParams(raw: unknown, known: readonly string[]): PluginActionParams {
  const result = PLUGIN_ACTION.safeParse(raw);
  if (!result.success) throw new Error(`Acción de plugin inválida (${describeIssues(result.error)}): ${previewValue(raw)}`);
  parseClaudeAccountDir(result.data.accountDir, known);
  return result.data;
}

function assertKnownMarketplace(deps: CapabilitiesIpcDeps, accountDir: string, marketplace: string): void {
  if (deps.pluginCatalog(accountDir).marketplaces.some((m) => m.name === marketplace)) return;
  throw new Error(`Marketplace desconocido para la cuenta: ${JSON.stringify(marketplace)}`);
}

function assertUserInstalled(deps: CapabilitiesIpcDeps, accountDir: string, selector: string): void {
  if (deps.overview(accountDir).plugins.some((p) => p.id === selector && p.scopes.includes('user'))) return;
  throw new Error(`El plugin no está instalado por el usuario en la cuenta: ${JSON.stringify(selector)}`);
}

// D-4: instalar solo desde un marketplace que la cuenta ya conoce (no se añade ninguno); quitar, activar o desactivar solo
// lo instalado en el ámbito de usuario de esa cuenta.
export async function runPluginAction(deps: CapabilitiesIpcDeps, params: PluginActionParams): Promise<void> {
  const { accountDir, action, plugin, marketplace } = params;
  const selector = `${plugin}@${marketplace}`;
  if (action === 'install') assertKnownMarketplace(deps, accountDir, marketplace);
  else assertUserInstalled(deps, accountDir, selector);
  await deps.runPluginCommand(accountDir, pluginActionCommand(action, selector));
}

export function registerCapabilitiesIpc(deps: CapabilitiesIpcDeps): void {
  deps.handle(IpcChannel.CapabilitiesOverview, (_event, arg) => deps.overview(parseClaudeAccountDir(arg, deps.claudeAccountDirs())));
  deps.handle(IpcChannel.CapabilitiesPluginCatalog, (_event, arg) => deps.pluginCatalog(parseClaudeAccountDir(arg, deps.claudeAccountDirs())));
  deps.handle(IpcChannel.CapabilitiesPluginAction, (_event, arg) => runPluginAction(deps, parsePluginActionParams(arg, deps.claudeAccountDirs())));
}
