import { useMemo, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { useCachedCommandCatalog } from '../commandCatalogStore';
import { filterCommands, groupCommandsByOrigin } from '../commandCatalogView';
import { Hint } from './TranscriptHint';
import type { SlashCommandInfo } from '@shared/events';

// Panel "Comandos y skills" (2.9.b): el catalogo REAL de comandos "/" de la cuenta, agrupado por el
// plugin o la skill de origen, con su descripcion, su pista de argumento y sus alias.
//
// La fuente es la de siempre: la SESION si ya reporto su catalogo, y si no la cache en disco por cuenta
// (2.2) — que es lo que hace que esta vista tenga contenido en una conversacion recien abierta, donde
// `ensureSession` aun no ha arrancado nada.
const EMPTY: readonly SlashCommandInfo[] = [];

export function CommandsPanel(): React.JSX.Element {
  const tabId = usePaneTabId();
  const sessionCommands = useWorkbenchStore((s) => s.slashCommandsByChat[tabId] ?? EMPTY);
  const cached = useCachedCommandCatalog();
  const [query, setQuery] = useState('');

  const commands = sessionCommands.length > 0 ? sessionCommands : cached;
  const groups = useMemo(() => groupCommandsByOrigin(filterCommands(commands, query)), [commands, query]);
  const total = commands.length;

  if (total === 0) {
    return <Hint text="Todavía no se conocen los comandos de esta cuenta. Se leen al arrancar la sesión." />;
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-[8px] border-b border-mg-border-subtle p-[8px_10px]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar comando"
          placeholder="Buscar…"
          className="min-w-0 flex-1 rounded-[6px] border border-mg-border-ctrl bg-mg-code p-[4px_8px] text-[11px] text-mg-text placeholder:text-mg-muted"
        />
        <span className="flex-none text-[10px] text-mg-muted">{total}</span>
      </div>
      <div className="flex min-h-0 flex-col gap-[10px] overflow-y-auto p-[10px]">
        {groups.length === 0 ? (
          <div className="text-[11px] text-mg-muted">Ningún comando casa con «{query}».</div>
        ) : (
          groups.map((group) => (
            <section key={group.origin} className="flex flex-col gap-[4px]">
              <div className="text-[9.5px] font-bold uppercase tracking-[.07em] text-mg-ter">
                {group.origin} ({group.commands.length})
              </div>
              {group.commands.map((command) => (
                <CommandRow key={command.name} command={command} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function CommandRow({ command }: { readonly command: SlashCommandInfo }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[1px] rounded-[6px] p-[4px_6px] hover:bg-mg-hover">
      <div className="flex items-baseline gap-[7px]">
        <span className="font-mono text-[11px] text-mg-body">/{command.name}</span>
        {/* La pista del argumento se PINTA, nunca se inserta: dice QUE espera, no con que valor. */}
        {command.argumentHint !== null && (
          <span className="font-mono text-[10px] italic text-mg-ter">{command.argumentHint}</span>
        )}
        {command.aliases.length > 0 && <span className="text-[10px] text-mg-muted">({command.aliases.join(', ')})</span>}
      </div>
      {command.description.length > 0 && (
        <span className="text-[10.5px] leading-[1.4] text-mg-sec2">{command.description}</span>
      )}
    </div>
  );
}
