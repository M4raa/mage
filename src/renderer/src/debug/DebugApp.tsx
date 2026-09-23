import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel, LogSource } from '@shared/debug';

// Tope de entradas en memoria del renderer (la UI no crece sin limite en sesiones largas).
const MAX_ENTRIES = 5000;
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const SOURCES: readonly LogSource[] = ['main', 'engine', 'renderer'];

type Toggle<K extends string> = Record<K, boolean>;

const ALL_LEVELS: Toggle<LogLevel> = { debug: true, info: true, warn: true, error: true };
const ALL_SOURCES: Toggle<LogSource> = { main: true, engine: true, renderer: true };

// Ventana de debug: visor tipo DevTools del stream unificado de logs (main + motor + renderer).
export function DebugApp(): React.JSX.Element {
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const [levels, setLevels] = useState<Toggle<LogLevel>>(ALL_LEVELS);
  const [sources, setSources] = useState<Toggle<LogSource>>(ALL_SOURCES);
  const [search, setSearch] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);

  // Suscripcion al stream (via preload). Al desmontar, desuscribe.
  useEffect(() => {
    const off = window.mageDebug?.onLog((entry) => {
      setEntries((prev) => {
        const next = prev.length >= MAX_ENTRIES ? prev.slice(prev.length - MAX_ENTRIES + 1) : prev;
        return [...next, entry];
      });
    });
    return off;
  }, []);

  const visible = useMemo(
    () => entries.filter((e) => levels[e.level] && sources[e.source] && matchesSearch(e, search)),
    [entries, levels, sources, search],
  );

  const toggleLevel = useCallback((l: LogLevel) => setLevels((p) => ({ ...p, [l]: !p[l] })), []);
  const toggleSource = useCallback((s: LogSource) => setSources((p) => ({ ...p, [s]: !p[s] })), []);
  const clear = useCallback(() => setEntries([]), []);
  const copyAll = useCallback(() => copyText(visible.map(formatEntry).join('\n\n')), [visible]);

  return (
    <div className="dbg-app">
      <Toolbar
        levels={levels}
        sources={sources}
        search={search}
        autoscroll={autoscroll}
        count={visible.length}
        onToggleLevel={toggleLevel}
        onToggleSource={toggleSource}
        onSearch={setSearch}
        onToggleAutoscroll={() => setAutoscroll((v) => !v)}
        onClear={clear}
        onCopyAll={copyAll}
      />
      <LogList entries={visible} autoscroll={autoscroll} />
    </div>
  );
}

function matchesSearch(entry: LogEntry, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (term.length === 0) return true;
  if (entry.message.toLowerCase().includes(term)) return true;
  return entry.data !== undefined && JSON.stringify(entry.data).toLowerCase().includes(term);
}

// Formatea una entrada como texto plano completo (para copiar al portapapeles con todo el contexto).
function formatEntry(entry: LogEntry): string {
  const head = `[${entry.timestamp}] ${entry.source.toUpperCase()} ${entry.level.toUpperCase()} — ${entry.message}`;
  if (entry.data === undefined) return head;
  return `${head}\n${JSON.stringify(entry.data, null, 2)}`;
}

// Copia texto al portapapeles (best-effort; en caso de fallo lo deja en la consola de la ventana).
function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch((err) => console.error('No se pudo copiar', err));
}

interface ToolbarProps {
  readonly levels: Toggle<LogLevel>;
  readonly sources: Toggle<LogSource>;
  readonly search: string;
  readonly autoscroll: boolean;
  readonly count: number;
  readonly onToggleLevel: (l: LogLevel) => void;
  readonly onToggleSource: (s: LogSource) => void;
  readonly onSearch: (v: string) => void;
  readonly onToggleAutoscroll: () => void;
  readonly onClear: () => void;
  readonly onCopyAll: () => void;
}

function Toolbar(props: ToolbarProps): React.JSX.Element {
  return (
    <div className="dbg-toolbar">
      <div className="dbg-group">
        {SOURCES.map((s) => (
          <span
            key={s}
            className={`dbg-chip ${props.sources[s] ? 'on' : ''}`}
            onClick={() => props.onToggleSource(s)}
          >
            {s}
          </span>
        ))}
      </div>
      <div className="dbg-group">
        {LEVELS.map((l) => (
          <span
            key={l}
            className={`dbg-chip ${props.levels[l] ? 'on' : ''}`}
            onClick={() => props.onToggleLevel(l)}
          >
            {l}
          </span>
        ))}
      </div>
      <input
        type="search"
        placeholder="Buscar en mensaje/datos…"
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
      />
      <button className="dbg-btn" onClick={props.onToggleAutoscroll}>
        {props.autoscroll ? '⏸ pausar' : '▶ autoscroll'}
      </button>
      <button className="dbg-btn" onClick={props.onCopyAll} title="Copiar las entradas visibles">
        ⧉ copiar {props.count}
      </button>
      <button className="dbg-btn" onClick={props.onClear}>
        limpiar
      </button>
    </div>
  );
}

function LogList({
  entries,
  autoscroll,
}: {
  readonly entries: readonly LogEntry[];
  readonly autoscroll: boolean;
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);

  // Autoscroll al fondo cuando llegan entradas y no esta pausado.
  useLayoutEffect(() => {
    if (!autoscroll || listRef.current === null) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries, autoscroll]);

  if (entries.length === 0) {
    return (
      <div className="dbg-list" ref={listRef}>
        <div className="dbg-empty">Sin entradas (o filtradas).</div>
      </div>
    );
  }

  return (
    <div className="dbg-list" ref={listRef}>
      {entries.map((entry) => (
        <LogRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function LogRow({ entry }: { readonly entry: LogEntry }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasData = entry.data !== undefined;
  const time = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm

  const onCopy = (e: React.MouseEvent): void => {
    e.stopPropagation(); // no plegar/desplegar al copiar
    copyText(formatEntry(entry));
  };

  return (
    <div className="dbg-row">
      <div className="dbg-row-head" onClick={() => hasData && setExpanded((v) => !v)}>
        <span className="dbg-caret">{hasData ? (expanded ? '▾' : '▸') : ''}</span>
        <span className="dbg-ts">{time}</span>
        <span className={`dbg-src ${entry.source}`}>{entry.source}</span>
        <span className={`dbg-level ${entry.level}`}>{entry.level}</span>
        <span className="dbg-msg">{entry.message}</span>
        <button className="dbg-copy" onClick={onCopy} title="Copiar esta entrada">
          ⧉
        </button>
      </div>
      {hasData && expanded && <pre className="dbg-data">{JSON.stringify(entry.data, null, 2)}</pre>}
    </div>
  );
}
