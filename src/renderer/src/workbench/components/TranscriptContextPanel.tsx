import { useMemo } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTranscriptStore } from '../paneContext';
import { useActiveTranscriptSessionId } from '../useActiveTranscript';
import {
  aggregateTokenUsage,
  buildContextSizeSeries,
  currentContextTokens,
  resolveContext,
  toTokenCategoryShares,
  type ContextUsageAdvice,
  type TokenCategoryKey,
  type TokenCategoryShare,
} from '../contextView';
import { ContextEvolutionChart } from './ContextEvolutionChart';
import { ContextBreakdown } from './ContextBreakdown';
import { Hint } from './TranscriptHint';
import { AGY_PROVIDER_ID, CODEX_PROVIDER_ID } from '@shared/providers';
import { providerUsageCategoryTotals } from '../providerUsage';

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

  // La OCUPACION de la ventana (P-028, punto 7): el desglose que reporta el CLI, el mismo de la barra de
  // estado; sin sesion viva, la estimacion de la transcripcion marcada como tal.
  const usage = useWorkbenchStore((s) => s.contextUsageByChat[s.activeTabId]);
  const model = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.model ?? '');
  const totals = useMemo(() => aggregateTokenUsage(entries), [entries]);
  const shares = useMemo(() => toTokenCategoryShares(totals), [totals]);
  const series = useMemo(() => buildContextSizeSeries(entries), [entries]);
  const context = useMemo(
    () => resolveContext(usage, { contextTokens: currentContextTokens(series), tokensOut: totals.outputTokens, model }),
    [usage, series, totals.outputTokens, model],
  );

  const provider = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.provider);
  // Codex y agy no dejan una transcripción de Claude ni dan el desglose de su contexto: el panel se alimenta del uso
  // que informa cada turno (y, en Codex, del tamaño de su ventana), con o sin sesión abierta.
  if (provider === CODEX_PROVIDER_ID || provider === AGY_PROVIDER_ID) return <ProviderContextPanel provider={provider} />;
  if (!hasSession) return <Hint text="Abre una conversación para ver su contexto." />;

  return (
    <div className="flex flex-col gap-[16px] p-[14px] text-[11px]">
      {context.advice.level !== 'ok' && (
        <ContextAdvisor
          advice={context.advice}
          // Compactar y el handoff actuan sobre el PROCESO del CLI, no sobre el fichero: sin sesion
          // viva no hay a quien mandarselo. Antes daba igual porque el panel entero se escondia sin
          // sesion; ahora que se muestra con la transcripcion en disco, los botones se van solos.
          canHandoff={isClaude && hasLiveSession}
          onHandoff={openHandoff}
          onCompact={() => void compactActiveSession()}
        />
      )}
      <section data-context-window="true" className="flex flex-col gap-[8px]">
        <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">VENTANA DE CONTEXTO</div>
        <ContextBreakdown usage={context.estimated ? undefined : usage} context={context.info} estimated={context.estimated} />
      </section>
      <ConsumedTokens entries={entries.length} isFinal={isFinal} errorMessage={errorMessage} refresh={refresh} totalTokens={totals.totalTokens}>
        {shares.map((share) => (
          <CategoryBar key={share.key} share={share} />
        ))}
      </ConsumedTokens>
      {totals.totalTokens > 0 && (
        <section className="flex flex-col gap-[8px] border-t border-mg-border-subtle pt-[12px]">
          <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">EVOLUCIÓN DEL CONTEXTO</div>
          <ContextEvolutionChart points={series} />
          <CompactionNote count={series.filter((p) => p.isCompaction).length} />
        </section>
      )}
    </div>
  );
}

// Panel de Contexto de una pestaña de Codex o agy: ocupación de la ventana (solo Codex la informa) y tokens acumulados
// desde que Mage abrió la conversación.
function ProviderContextPanel({ provider }: { readonly provider: string }): React.JSX.Element {
  const tabId = useWorkbenchStore((s) => s.activeTabId);
  const usage = useWorkbenchStore((s) => s.contextUsageByChat[tabId]);
  const totals = useWorkbenchStore((s) => s.providerUsageByChat[tabId]);
  const model = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId)?.model ?? '');
  const context = usage !== undefined && usage.maxTokens > 0 ? resolveContext(usage, { contextTokens: 0, tokensOut: totals?.outputTokens ?? 0, model }) : null;
  const shares = totals === undefined ? [] : toTokenCategoryShares(providerUsageCategoryTotals(totals));
  const totalTokens = totals === undefined ? 0 : providerUsageCategoryTotals(totals).totalTokens;
  const name = provider === AGY_PROVIDER_ID ? 'agy' : 'Codex';
  return (
    <div data-provider-context-panel={provider} className="flex flex-col gap-[16px] p-[14px] text-[11px]">
      {context !== null && context.advice.level !== 'ok' && (
        <ContextAdvisor advice={context.advice} canHandoff={false} onHandoff={() => undefined} onCompact={() => undefined} />
      )}
      <section data-context-window="true" className="flex flex-col gap-[8px]">
        <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">VENTANA DE CONTEXTO</div>
        {context !== null && <ContextBreakdown usage={usage} context={context.info} noBreakdownNote={`${name} no da el desglose por categorías.`} />}
        {context === null && totals !== undefined && (
          <div className="text-mg-body2">
            Último prompt: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totals.lastInputTokens.toLocaleString('es')}</span> tokens. {name} no informa el tamaño de su ventana.
          </div>
        )}
        {context === null && totals === undefined && <div className="text-mg-ter">Aún sin turnos: {name} informa el uso al terminar el primero.</div>}
      </section>
      <section className="flex flex-col gap-[10px] border-t border-mg-border-subtle pt-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">TOKENS CONSUMIDOS (acumulado)</span>
          {totals !== undefined && (
            <span className="text-[10px] text-mg-body" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {totalTokens.toLocaleString('es')} tok
            </span>
          )}
        </div>
        {totals === undefined ? <div className="text-[10.5px] text-mg-ter">Sin turnos todavía en esta conversación.</div> : shares.map((share) => <CategoryBar key={share.key} share={share} />)}
        <div className="text-[10px] text-mg-muted">Desde que Mage abrió esta conversación: no se reconstruye del historial del CLI.</div>
      </section>
    </div>
  );
}

// Lo FACTURADO en toda la conversacion, que no es la ocupacion (P-028): antes era lo unico del panel, con
// el rotulo «TOKENS POR CATEGORÍA». Sus estados de lectura ya no ocultan la ventana de arriba.
function ConsumedTokens({
  entries,
  isFinal,
  errorMessage,
  refresh,
  totalTokens,
  children,
}: {
  readonly entries: number;
  readonly isFinal: boolean;
  readonly errorMessage: string | null;
  readonly refresh: () => void;
  readonly totalTokens: number;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const hint = consumedTokensHint({ entries, isFinal, errorMessage, totalTokens });
  return (
    <section className="flex flex-col gap-[10px] border-t border-mg-border-subtle pt-[12px]">
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">TOKENS CONSUMIDOS (acumulado)</span>
        <div className="flex items-center gap-[8px]">
          {hint === null && (
            <span className="text-[10px] text-mg-body" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {totalTokens.toLocaleString('es')} tok
            </span>
          )}
          <button
            onClick={refresh}
            data-tip="Releer transcripción"
            className="flex h-5 w-5 items-center justify-center rounded-[5px] text-mg-muted hover:bg-mg-hover hover:text-mg-body"
          >
            ⟳
          </button>
        </div>
      </div>
      {hint === null ? children : <div className="text-[10.5px] text-mg-ter">{hint}</div>}
    </section>
  );
}

function consumedTokensHint(state: { readonly entries: number; readonly isFinal: boolean; readonly errorMessage: string | null; readonly totalTokens: number }): string | null {
  if (state.errorMessage !== null) return `No se pudo leer la transcripción: ${state.errorMessage}`;
  if (!state.isFinal && state.totalTokens === 0) return 'Cargando transcripción…';
  if (state.entries === 0) return 'Transcripción vacía.';
  if (state.totalTokens === 0) return 'Sin datos de uso de tokens en esta transcripción.';
  return null;
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
