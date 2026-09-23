import { formatTokensShort, occupiedCategories } from '../contextView';
import type { ContextUsage } from '@shared/events';
import type { ContextInfo } from '../types';

// Desglose de EN QUE se gasta el contexto, para el popover del indicador de la barra de estado (2.8).
// Responde a la pregunta que el porcentaje solo no contesta ("¿por que llevo 39k sin haber escrito
// nada?" -> system prompt + tools + skills + memoria). Nombres de categoria TAL CUAL los da el CLI, sin
// traducir: son su vocabulario y asi coinciden con lo que muestra `/context`.
//
// Misma plantilla visual que `StatusPopover`/`UsagePopover` (ancho, radio, borde, sombra y rotulo), que
// es lo que hace que los tres popovers de la barra se lean como el mismo control.
export function ContextPopover({
  usage,
  context,
}: {
  readonly usage: ContextUsage | undefined;
  readonly context: ContextInfo;
}): React.JSX.Element {
  const categories = usage === undefined ? [] : occupiedCategories(usage);
  return (
    <div className="flex w-[248px] flex-col gap-2 rounded-[9px] border border-mg-border-pop bg-mg-popover p-[11px_12px] text-[10.5px] mg-shadow-pop">
      <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">CONTEXTO</div>
      <div className="flex justify-between text-mg-body2">
        <span>Usado</span>
        <span className="text-mg-body">
          {context.usedTokens} / {context.maxTokens}
        </span>
      </div>
      <div className="h-[3px] rounded-[2px] bg-mg-track">
        <div className="h-full rounded-[2px] bg-mg-fill" style={{ width: `${context.usedPct}%` }} />
      </div>
      {categories.length === 0 ? (
        <div className="text-mg-ter">Sin desglose todavía.</div>
      ) : (
        <div className="flex flex-col gap-[4px] border-t border-mg-border-subtle pt-[7px]">
          {categories.map((category) => (
            <div key={category.name} className="flex justify-between">
              <span className="truncate text-mg-body2">{category.name}</span>
              <span className="flex-none pl-[8px] text-mg-ter">{formatTokensShort(category.tokens)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between border-t border-mg-border-subtle pt-[7px]">
        <span className="text-mg-body2">Tokens out</span>
        <span className="text-mg-ter">{context.tokensOut}</span>
      </div>
    </div>
  );
}
