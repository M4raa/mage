import { formatTokensShort, occupiedCategories } from '../contextView';
import type { ContextUsage } from '@shared/events';
import type { ContextInfo } from '../types';

// Uso / ventana, barra y categorias ocupadas (P-028, punto 7): lo pinta el panel de Contexto (antes solo enseñaba lo
// facturado y no la ocupacion). Nombres de categoria TAL CUAL los da el CLI, sin traducir: coinciden con `/context`.
export function ContextBreakdown({
  usage,
  context,
  estimated = false,
  noBreakdownNote,
}: {
  readonly usage: ContextUsage | undefined;
  readonly context: ContextInfo;
  readonly estimated?: boolean;
  // Texto cuando el CLI no da desglose por categorías (Codex): sustituye al genérico.
  readonly noBreakdownNote?: string;
}): React.JSX.Element {
  const categories = usage === undefined ? [] : occupiedCategories(usage);
  return (
    <div data-context-breakdown={estimated ? 'estimado' : 'cli'} className="flex flex-col gap-2">
      <div className="flex justify-between text-mg-body2">
        <span>Usado{estimated && <span className="pl-[6px] text-mg-muted">estimado</span>}</span>
        <span className="text-mg-body" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {context.usedTokens} / {context.maxTokens} · {context.usedPct}%
        </span>
      </div>
      <div className="h-[3px] rounded-[2px] bg-mg-track">
        <div className="h-full rounded-[2px] bg-mg-fill" style={{ width: `${context.usedPct}%` }} />
      </div>
      {categories.length === 0 ? (
        <div className="text-mg-ter">{noBreakdownNote ?? (estimated ? 'Sin desglose: la conversación no tiene sesión abierta.' : 'Sin desglose todavía.')}</div>
      ) : (
        <div className="flex flex-col gap-[4px] border-t border-mg-border-subtle pt-[7px]">
          {categories.map((category) => (
            <div key={category.name} data-context-category={category.name} className="flex justify-between">
              <span className="truncate text-mg-body2">{category.name}</span>
              <span className="flex-none pl-[8px] text-mg-ter">{formatTokensShort(category.tokens)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
