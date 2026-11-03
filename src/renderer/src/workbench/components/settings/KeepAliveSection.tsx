import { useEffect, useState } from 'react';
import type { KeepAliveStats } from '@shared/ipc';
import {
  KEEP_ALIVE_MAX_PAUSE_MAX,
  KEEP_ALIVE_MAX_PAUSE_MIN,
  KEEP_ALIVE_MIN_CONTEXT_MAX,
  KEEP_ALIVE_MIN_CONTEXT_MIN,
  type KeepAliveSettings,
} from '@shared/settings';
import { formatMicroUsd } from '@shared/usage';
import { useT } from '../../../i18n/uiLanguage';
import { activeFormatLocale } from '../../../i18n/format';
import { formatTokensShort } from '../../contextView';
import { useWorkbenchStore } from '../../workbenchStore';

const CONTEXT_STEP_TOKENS = 10_000;
const INPUT_CLASS = 'w-[90px] rounded-[4px] border border-mg-border bg-transparent px-[6px] py-[2px] text-[11.5px] text-mg-body';

type NumericField = 'minContextTokens' | 'maxPauseHours';

interface NumberFieldProps {
  readonly field: NumericField;
  readonly label: string;
  readonly hint: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

// Campo numérico que se aplica al perder el foco o con Enter. Un valor que la acción rechaza vuelve al anterior.
function NumberField({ field, label, hint, min, max, step }: NumberFieldProps): React.JSX.Element {
  const stored = useWorkbenchStore((s) => s.settings.keepAlive[field]);
  const setKeepAlive = useWorkbenchStore((s) => s.setKeepAlive);
  const [draft, setDraft] = useState(String(stored));
  useEffect(() => setDraft(String(stored)), [stored]);

  const apply = (): void => {
    try {
      setKeepAlive({ [field]: Number(draft) } as Partial<KeepAliveSettings>);
    } catch (error) {
      console.warn(`Keep-alive: valor rechazado en ${field}: ${JSON.stringify(draft)}`, error);
      setDraft(String(stored));
    }
  };

  return (
    <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
      <input
        type="number"
        className={INPUT_CLASS}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{hint}</span>
      </span>
    </label>
  );
}

interface ToggleProps {
  readonly field: 'subscriptionEnabled' | 'apiKeyEnabled';
  readonly label: string;
  readonly hint: string;
}

function Toggle({ field, label, hint }: ToggleProps): React.JSX.Element {
  const checked = useWorkbenchStore((s) => s.settings.keepAlive[field]);
  const setKeepAlive = useWorkbenchStore((s) => s.setKeepAlive);
  return (
    <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
      <input type="checkbox" className="mt-[3px]" checked={checked} onChange={(e) => setKeepAlive({ [field]: e.target.checked })} />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{hint}</span>
      </span>
    </label>
  );
}

type StatsState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'ready'; readonly stats: KeepAliveStats };

// Registro de lo que se lleva gastado en mantenimientos: se lee una vez al montar.
function KeepAliveLog(): React.JSX.Element | null {
  const t = useT();
  const [state, setState] = useState<StatsState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    window.mage
      .keepAliveStats()
      .then((stats) => alive && setState({ kind: 'ready', stats }))
      .catch((error: unknown) => {
        console.warn('Keep-alive: no se pudo leer el registro', error);
        if (alive) setState({ kind: 'failed' });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === 'loading') return null;
  if (state.kind === 'failed') return <span className="text-[10.5px] text-mg-ter">{t('settings.keepAlive.statsUnavailable')}</span>;
  const { stats } = state;
  const text =
    stats.count === 0
      ? t('settings.keepAlive.statsNone')
      : t('settings.keepAlive.stats', {
          count: stats.count,
          read: formatTokensShort(stats.cacheReadTokens),
          written: formatTokensShort(stats.cacheCreationTokens),
          cost: formatMicroUsd(stats.costMicroUsd, activeFormatLocale()),
        });
  return <span className="text-[10.5px] text-mg-ter">{text}</span>;
}

// U11 y U15: mantener caliente la caché de Claude en conversaciones grandes abiertas. Apagado por defecto en
// las cuentas por clave de API, porque cada mantenimiento se factura como un turno.
export function KeepAliveSection(): React.JSX.Element {
  const t = useT();
  return (
    <div data-setting="keep-alive" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.keepAlive.label')}</span>
      <Toggle field="subscriptionEnabled" label={t('settings.keepAlive.subscription')} hint={t('settings.keepAlive.subscriptionHint')} />
      <Toggle field="apiKeyEnabled" label={t('settings.keepAlive.apiKey')} hint={t('settings.keepAlive.apiKeyHint')} />
      <NumberField
        field="minContextTokens"
        label={t('settings.keepAlive.minContext')}
        hint={t('settings.keepAlive.minContextHint')}
        min={KEEP_ALIVE_MIN_CONTEXT_MIN}
        max={KEEP_ALIVE_MIN_CONTEXT_MAX}
        step={CONTEXT_STEP_TOKENS}
      />
      <NumberField
        field="maxPauseHours"
        label={t('settings.keepAlive.maxPause')}
        hint={t('settings.keepAlive.maxPauseHint')}
        min={KEEP_ALIVE_MAX_PAUSE_MIN}
        max={KEEP_ALIVE_MAX_PAUSE_MAX}
        step={1}
      />
      <KeepAliveLog />
    </div>
  );
}
