import { useMemo } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTranscriptStore } from '../paneContext';
import { useActiveTranscriptSessionId } from '../useActiveTranscript';
import {
  aggregateTokenUsage,
  buildContextSizeSeries,
  contextUsageAdvice,
  currentContextTokens,
  toTokenCategoryShares,
  type ContextUsageAdvice,
  type TokenCategoryKey,
  type TokenCategoryShare,
} from '../contextView';
import { ContextEvolutionChart } from './ContextEvolutionChart';
import { Hint } from './TranscriptHint';

// Color fijo por categoria (orden fijo, nunca por rango). Tokens `dataviz` slots 1-4 como variables
// CSS del tema (M3, conmutan claro/oscuro): cada barra ademas lleva su etiqueta -> identidad nunca solo por color.
const CATEGORY_COLOR: Readonly<Record<TokenCategoryKey, string>> = {
  input: 'var(--mg-chart-1)', // slot 1 blue
  output: 'var(--mg-chart-2)', // slot 2 green
  cacheCreation: 'var(--mg-chart-3)', // slot 3 magenta
  cacheRead: 'var(--mg-chart-4)', // slot 4 yellow
};

// Pestana "Contexto" del Inspector: sobre los `entries` YA cargados por el transcriptStore (la
// apertura/cancelacion vive en Inspector.tsx), muestra (a) atribucion de tokens por categoria y
// (b) evolucion del tamano de contexto con marca de compactacion. PRESENTACION PURA: no dispara
// ninguna lectura (igual que UsagePanel no dispara su propio fetch).
export function TranscriptContextPanel(): React.JSX.Element {
  // La sesion a MOSTRAR, no la viva: al abrir una conversacion del historial no hay proceso del CLI
  // todavia (arranca perezoso al primer mensaje) y este panel contestaba "Sin conversacion activa"
  // encima de una conversacion llena. Ver `useActiveTranscript.ts`.
  const shownSessionId = useActiveTranscriptSessionId();
  const hasSession = shownSessionId !== undefined;
  // Compactar y el handoff SI necesitan sesion viva: son acciones sobre el proceso, no sobre el fichero.
  const hasLiveSession = useWorkbenchStore((s) => s.sessionIdByChat[s.activeTabId] !== undefined);
  const isClaude = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.provider === 'claude');
  const openHandoff = useWorkbenchStore((s) => s.openHandoff);
  const compactActiveSession = useWorkbenchStore((s) => s.compactActiveSession);
  // 4.1: el store de la pestaña ACTIVA (este panel vive fuera del centro, asi que `usePaneTabId`
  // devuelve la activa). Decision del usuario: los paneles globales siguen a la pestaña activa.
  const useTranscriptStore = usePaneTranscriptStore();
  const entries = useTranscriptStore((s) => s.entries);
  const errorMessage = useTranscriptStore((s) => s.errorMessage);
  const isFinal = useTranscriptStore((s) => s.isFinal);
  const refresh = useTranscriptStore((s) => s.refresh);

  const totals = useMemo(() => aggregateTokenUsage(entries), [entries]);
  const shares = useMemo(() => toTokenCategoryShares(totals), [totals]);
  const series = useMemo(() => buildContextSizeSeries(entries), [entries]);
  const advice = useMemo(() => contextUsageAdvice(currentContextTokens(series)), [series]);

  if (!hasSession) return <Hint text="Abre una conversación para ver su contexto." />;
  if (errorMessage !== null) return <Hint text={`No se pudo leer la transcripción: ${errorMessage}`} onRetry={refresh} />;
  if (entries.length === 0) return <Hint text={isFinal ? 'Transcripción vacía.' : 'Cargando transcripción…'} onRetry={refresh} />;
  if (totals.totalTokens === 0) {
    return <Hint text={isFinal ? 'Sin datos de uso de tokens en esta transcripción.' : 'Cargando transcripción…'} onRetry={refresh} />;
  }

  return (
    <div className="flex flex-col gap-[16px] p-[14px] text-[11px]">
      {advice.level !== 'ok' && (
        <ContextAdvisor
          advice={advice}
          // Compactar y el handoff actuan sobre el PROCESO del CLI, no sobre el fichero: sin sesion
          // viva no hay a quien mandarselo. Antes daba igual porque el panel entero se escondia sin
          // sesion; ahora que se muestra con la transcripcion en disco, los botones se van solos.
          canHandoff={isClaude && hasLiveSession}
          onHandoff={openHandoff}
          onCompact={() => void compactActiveSession()}
        />
      )}
      <section className="flex flex-col gap-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">TOKENS POR CATEGORÍA</span>
          <div className="flex items-center gap-[8px]">
            <span className="text-[10px] text-mg-body" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {totals.totalTokens.toLocaleString('es')} tok
            </span>
            <button
              onClick={refresh}
              data-tip="Releer transcripción"
              className="flex h-5 w-5 items-center justify-center rounded-[5px] text-mg-muted hover:bg-mg-hover hover:text-mg-body"
            >
              ⟳
            </button>
          </div>
        </div>
        {shares.map((share) => (
          <CategoryBar key={share.key} share={share} />
        ))}
      </section>

      <section className="flex flex-col gap-[8px] border-t border-mg-border-subtle pt-[12px]">
        <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">EVOLUCIÓN DEL CONTEXTO</div>
        <ContextEvolutionChart points={series} />
        <CompactionNote count={series.filter((p) => p.isCompaction).length} />
      </section>
    </div>
  );
}

// Aviso de ocupacion de la ventana de contexto (M2.4). No invasivo: informa del % y ofrece
// compactar la sesion (/compact) o un handoff (chat nuevo autocontenido). warn = ambar, high = rojo.
function ContextAdvisor({
  advice,
  canHandoff,
  onHandoff,
  onCompact,
}: {
  readonly advice: ContextUsageAdvice;
  readonly canHandoff: boolean;
  readonly onHandoff: () => void;
  readonly onCompact: () => void;
}): React.JSX.Element {
  const high = advice.level === 'high';
  const skin = high ? 'border-mg-danger-border bg-mg-danger-bg text-mg-danger' : 'border-mg-warn-border bg-mg-warn-bg text-mg-warn-text';
  return (
    <div className={`flex flex-col gap-[8px] rounded-[8px] border p-[10px_12px] ${skin}`}>
      <div className="text-[11px] leading-[1.5]">
        <span className="font-bold">Contexto al {advice.pct}%.</span>{' '}
        {high
          ? 'La ventana está casi llena; crea un handoff para continuar en un chat nuevo sin perder contexto.'
          : 'Se está llenando; considera un handoff pronto para no perder contexto.'}
      </div>
      {canHandoff && (
        <div className="flex items-center gap-[8px]">
          <button
            onClick={onCompact}
            data-tip="Compacta el contexto de la sesión (/compact)"
            className="rounded-[6px] border border-mg-border-emph px-[10px] py-[4px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
          >
            <Icon name="compress" size={12} /> Compactar ahora
          </button>
          <button
            onClick={onHandoff}
            className="rounded-[6px] border border-mg-border-emph px-[10px] py-[4px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
          >
            <Icon name="handshake" size={12} /> Crear handoff
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryBar({ share }: { readonly share: TokenCategoryShare }): React.JSX.Element {
  const color = CATEGORY_COLOR[share.key];
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="flex items-center gap-[6px] truncate text-mg-ter">
          <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: color }} />
          {share.label}
        </span>
        <span className="text-mg-body" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {share.pct}% · {share.tokens.toLocaleString('es')}
        </span>
      </div>
      <div className="h-[4px] rounded-[2px] bg-mg-track">
        <div className="h-full rounded-[2px]" style={{ width: `${share.pct}%`, background: color }} />
      </div>
    </div>
  );
}

function CompactionNote({ count }: { readonly count: number }): React.JSX.Element {
  if (count === 0) return <div className="text-[10px] text-mg-muted">Sin compactaciones detectadas.</div>;
  return (
    <div className="flex items-center gap-[6px] text-[10px] text-mg-ter">
      <span style={{ color: 'var(--mg-chart-event)' }}>⟲</span>
      {count === 1 ? '1 compactación de contexto detectada' : `${count} compactaciones de contexto detectadas`}
    </div>
  );
}
