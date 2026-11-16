import type { MessageKey } from '@shared/i18n/messageKeys.generated';

// Lógica pura de las páginas de Capacidades: qué cuenta de Claude se enseña y cómo se nombran las políticas.

// La cuenta elegida si existe; si no, la activa si es de Claude; si no, la primera.
export function pickClaudeAccount(ids: readonly string[], picked: string | null, active: string): string | null {
  if (picked !== null && ids.includes(picked)) return picked;
  if (ids.includes(active)) return active;
  return ids[0] ?? null;
}

const POLICY_LABELS = {
  allow_remote_sessions: 'capabilities.org.policy.allowRemoteSessions',
  allow_remote_control: 'capabilities.org.policy.allowRemoteControl',
  allow_routines: 'capabilities.org.policy.allowRoutines',
  allow_quick_web_setup: 'capabilities.org.policy.allowQuickWebSetup',
  allow_connector_file_downloads: 'capabilities.org.policy.allowConnectorFileDownloads',
  enforce_web_search_mcp_isolation: 'capabilities.org.policy.enforceWebSearchMcpIsolation',
  require_trusted_devices: 'capabilities.org.policy.requireTrustedDevices',
  remote_control_at_startup: 'capabilities.org.policy.remoteControlAtStartup',
  channelsEnabled: 'capabilities.org.policy.channelsEnabled',
} as const satisfies Readonly<Record<string, MessageKey>>;
type PolicyLabelKey = (typeof POLICY_LABELS)[keyof typeof POLICY_LABELS];
const POLICY_LABEL_BY_NAME: ReadonlyMap<string, PolicyLabelKey> = new Map(Object.entries(POLICY_LABELS));

// Un nombre que no está aquí se pinta crudo.
export function policyLabelKey(name: string): PolicyLabelKey | null {
  return POLICY_LABEL_BY_NAME.get(name) ?? null;
}

export type PolicyStateKey = 'capabilities.org.state.on' | 'capabilities.org.state.off';

export function allowedKey(allowed: boolean): PolicyStateKey {
  return allowed ? 'capabilities.org.state.on' : 'capabilities.org.state.off';
}

// 'true' → activado, 'false' → desactivado; cualquier otro texto se pinta tal cual.
export function entryValueKey(value: string): PolicyStateKey | null {
  if (value === 'true') return 'capabilities.org.state.on';
  if (value === 'false') return 'capabilities.org.state.off';
  return null;
}
