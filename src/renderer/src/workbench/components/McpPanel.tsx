import { useEffect } from 'react';
import type { McpServerStatus } from '@shared/events';
import { useWorkbenchStore } from '../workbenchStore';
import { useSharedConfigStore } from '../sharedConfigStore';
import { NEEDS_AUTH, tagSessionServers } from '../mcpView';
import { McpAuthActions, OriginBadge } from './settings/McpSection';
import { Hint } from './TranscriptHint';
import { AGY_PROVIDER_ID } from '@shared/providers';

// Referencia ESTABLE para el fallback del selector: un array NUEVO en cada render (`?? []`) rompe la
// igualdad referencial que espera Zustand y provoca un bucle infinito de renders (mismo patron que
// EMPTY_COMMANDS en PromptBar.tsx / el bug historico de selectVisibleChats, ver BITACORA 2026-07-12).
const EMPTY_MCP_SERVERS: readonly McpServerStatus[] = [];

// Pestaña "MCP" del Inspector (D1 Fase 2): servidores MCP que la sesión activa cargó DE VERDAD
// (mcp_servers del evento init), con la misma insignia que «MCP y conectores» (P-028): «Mage» si viene
// de mcp-common.json, «claude.ai» o «Plugin X» por su prefijo medido y «Cuenta o proyecto» el resto; el
// estado va traducido. El origen se calcula por NOMBRE (mcpView.ts, puro): si el mismo nombre
// existiera en los dos sitios con configuración distinta, gana el común (verificado en vivo, D1
// Fase 1) — esta vista solo reporta lo que la sesión efectivamente cargó, no puede distinguir esa
// colisión por sí sola.
export function McpPanel(): React.JSX.Element {
  const mcpServers = useWorkbenchStore((s) => s.mcpServersByChat[s.activeTabId] ?? EMPTY_MCP_SERVERS);
  const hasLiveSession = useWorkbenchStore((s) => s.sessionIdByChat[s.activeTabId] !== undefined);
  const accountId = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.accountId);
  const provider = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.provider);
  const snapshot = useSharedConfigStore((s) => s.snapshot);
  const loadSharedConfig = useSharedConfigStore((s) => s.load);

  // Carga el snapshot (para saber qué nombres son "comunes") si nadie lo pidió aún en esta sesión de
  // la app — p.ej. el usuario nunca abrió Configuración. Barato: dos ficheros pequeños.
  useEffect(() => {
    if (snapshot === null) void loadSharedConfig();
  }, [snapshot]);

  // agy no reporta sus MCP en el stream (medido en 1.2.14: su `init` no trae `mcpServers`).
  if (provider === AGY_PROVIDER_ID) {
    return <Hint text="agy no informa del estado de sus MCP. Los que tiene (incluidos los que le sincroniza Mage) se ven en Configuración › MCP y conectores." />;
  }

  if (mcpServers.length === 0) {
    // Distinguir "no cargo ninguno" de "todavia no hay a quien preguntar". Los servidores MCP los
    // reporta el CLI en su `session_init`, asi que sin sesion viva no hay dato — y decir "esta sesion
    // no cargo ninguno" sobre una conversacion recien abierta del historial es sencillamente falso.
    return (
      <Hint
        text={
          hasLiveSession
            ? 'Esta sesión no cargó ningún servidor MCP.'
            : 'Los servidores MCP los reporta el agente al arrancar. Envía un mensaje para saber cuáles carga esta conversación.'
        }
      />
    );
  }

  const tagged = tagSessionServers(mcpServers, snapshot?.mcpCommonServerNames ?? []);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-mg-border-subtle px-[10px] py-[6px] text-[10px] text-mg-ter">
        <span className="font-bold tracking-[.06em]">SERVIDORES MCP ({tagged.length})</span>
      </div>
      <ul className="flex flex-1 flex-col gap-[6px] overflow-y-auto px-[10px] py-[8px]">
        {tagged.map((server) => (
          <li key={server.name} className="flex flex-col gap-[2px] rounded-[6px] border border-mg-border-subtle px-[8px] py-[6px]">
            <div className="flex items-center justify-between gap-[8px]">
              <span className="min-w-0 truncate text-[11px] text-mg-body" data-tip={server.name}>
                {server.name}
              </span>
              <div className="flex shrink-0 items-center gap-[6px]">
                <span className="text-[9.5px] text-mg-ter">{server.statusLabel}</span>
                <OriginBadge badge={server.badge} />
              </div>
            </div>
            {/* El token queda en la cuenta: esta conversacion sigue con el estado con que arranco. */}
            {server.status === NEEDS_AUTH && accountId !== undefined && <McpAuthActions serverName={server.name} accountDirs={[accountId]} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
