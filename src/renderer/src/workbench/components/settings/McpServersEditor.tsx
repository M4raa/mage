import { useEffect, useState } from 'react';
import { useSharedConfigStore } from '../../sharedConfigStore';
import { BlockShell, RemoveButton } from './CommonRulesEditor';
import { parseEnvText, parseMcpServers, serializeMcpServers, type McpServerDraft } from './sharedConfigModel';

// Editor por BLOQUES de `mcp-common.json`: un servidor MCP se añade y se edita con campos (nombre,
// comando, argumentos, variables de entorno) en vez de escribiendo JSON a mano. El fichero en disco
// sigue siendo el mismo JSON que el CLI recibe por `--mcp-config`.

const INPUT_CLASS =
  'w-full min-w-0 rounded-[5px] border border-mg-border-subtle bg-mg-panel px-[7px] py-[3px] font-mono text-[11px] text-mg-body outline-none focus:border-mg-border-emph';

const EMPTY_SERVER: McpServerDraft = { name: '', command: '', argsText: '', envText: '', rest: {} };

export function McpServersEditor(): React.JSX.Element {
  const snapshot = useSharedConfigStore((s) => s.snapshot);
  const save = useSharedConfigStore((s) => s.save);
  const saving = useSharedConfigStore((s) => s.savingByFile['mcp-common']);
  const saveError = useSharedConfigStore((s) => s.saveErrorByFile['mcp-common']);

  const text = snapshot?.mcpCommonText ?? '{"mcpServers": {}}';
  const [servers, setServers] = useState<readonly McpServerDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const parsed = parseMcpServers(text);

  // Igual que en CommonRulesEditor: no se pisa un borrador a medias cuando el snapshot se recarga
  // por haber guardado el OTRO fichero comun.
  useEffect(() => {
    if (dirty) return;
    setServers(parsed.servers);
  }, [text]);

  const edit = (next: readonly McpServerDraft[]): void => {
    setServers(next);
    setDirty(true);
    setWriteError(null);
  };

  const handleSave = (): void => {
    if (snapshot === null) return;
    const invalid = validateServers(servers);
    if (invalid !== null) {
      setWriteError(invalid);
      return;
    }
    let serialized: string;
    try {
      serialized = serializeMcpServers(snapshot.mcpCommonText, servers);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
      return;
    }
    void save('mcp-common', serialized, snapshot.mcpCommonBaseline).then((saved) => {
      if (!saved) return;
      // Se re-lee lo que quedo EN DISCO (mismo motivo que en CommonRulesEditor): el efecto de
      // sincronizacion no entra mientras `dirty` siga a true.
      setServers(parseMcpServers(useSharedConfigStore.getState().snapshot?.mcpCommonText ?? '{}').servers);
      setDirty(false);
    });
  };

  if (snapshot === null) return <p className="text-[11px] text-mg-muted">Cargando…</p>;

  return (
    <div className="flex flex-col gap-[12px]">
      {parsed.error !== null && (
        <div role="alert" className="rounded-[6px] border border-mg-danger-border bg-mg-danger-bg p-[7px_9px] text-[10.5px] text-mg-danger">
          El fichero <code>mcp-common.json</code> no se pudo interpretar ({parsed.error}). Al guardar desde aquí se
          reescribirá con lo que muestre esta pantalla.
        </div>
      )}

      <BlockShell
        title={`Servidores MCP comunes (${servers.length})`}
        hint="Se añaden a los que ya tenga cada cuenta; nunca los sustituyen."
        addLabel="Añadir servidor"
        onAdd={() => edit([...servers, EMPTY_SERVER])}
      >
        {servers.length === 0 && (
          <p className="text-[11px] text-mg-muted">Todavía no hay ningún servidor común.</p>
        )}
        {servers.map((server, index) => (
          <ServerCard
            key={index}
            server={server}
            index={index}
            onChange={(patch) => edit(servers.map((s, i) => (i === index ? { ...s, ...patch } : s)))}
            onRemove={() => edit(servers.filter((_, i) => i !== index))}
          />
        ))}
      </BlockShell>

      <div className="flex items-center gap-[10px]">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-[6px] border border-mg-border-emph px-[10px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {dirty && <span className="text-[10.5px] text-mg-warn-text">Hay cambios sin guardar.</span>}
      </div>
      {writeError !== null && <div role="alert" className="text-[10.5px] text-mg-danger">{writeError}</div>}
      {saveError !== null && <div role="alert" className="text-[10.5px] text-mg-danger">No se pudo guardar: {saveError}</div>}
    </div>
  );
}

// Validacion en la frontera de la UI: el nombre es la CLAVE del objeto, asi que uno vacio o repetido
// perderia servidores en silencio al serializar. Devuelve el primer problema, o null si todo va bien.
function validateServers(servers: readonly McpServerDraft[]): string | null {
  const seen = new Set<string>();
  for (const server of servers) {
    const name = server.name.trim();
    if (name.length === 0) return 'Todos los servidores necesitan un nombre.';
    if (seen.has(name)) return `Hay dos servidores con el nombre "${name}": los nombres son la clave y deben ser únicos.`;
    seen.add(name);
    if (server.command.trim().length === 0) return `El servidor "${name}" no tiene comando.`;
    const env = parseEnvText(server.envText);
    if (env.error !== null) return `Variables de entorno de "${name}" inválidas: ${env.error}`;
  }
  return null;
}

function ServerCard({
  server,
  index,
  onChange,
  onRemove,
}: {
  readonly server: McpServerDraft;
  readonly index: number;
  readonly onChange: (patch: Partial<McpServerDraft>) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const label = server.name.length > 0 ? server.name : `servidor ${index + 1}`;
  return (
    <div className="flex flex-col gap-[6px] rounded-[7px] border border-mg-border-subtle bg-mg-panel p-[8px]">
      <div className="flex items-center gap-[6px]">
        <input
          value={server.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="nombre"
          aria-label={`Nombre del ${label}`}
          className={`${INPUT_CLASS} w-[150px] flex-none`}
        />
        <input
          value={server.command}
          onChange={(e) => onChange({ command: e.target.value })}
          placeholder="comando (npx, node, python…)"
          aria-label={`Comando del ${label}`}
          className={INPUT_CLASS}
        />
        <RemoveButton label={`Quitar el ${label}`} onClick={onRemove} />
      </div>
      <Field
        label="Argumentos (uno por línea)"
        value={server.argsText}
        placeholder={'-y\n@scope/servidor-mcp'}
        ariaLabel={`Argumentos del ${label}`}
        onChange={(value) => onChange({ argsText: value })}
      />
      <Field
        label="Variables de entorno (CLAVE=valor, una por línea)"
        value={server.envText}
        placeholder="API_TOKEN=..."
        ariaLabel={`Variables de entorno del ${label}`}
        onChange={(value) => onChange({ envText: value })}
      />
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  ariaLabel,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-[9.5px] uppercase tracking-[.06em] text-mg-ter">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        rows={2}
        aria-label={ariaLabel}
        className={`${INPUT_CLASS} resize-y`}
      />
    </label>
  );
}
