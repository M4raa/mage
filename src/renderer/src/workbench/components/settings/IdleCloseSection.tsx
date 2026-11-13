import { useEffect, useState } from 'react';
import { IDLE_CLOSE_LIMITS } from '@shared/settings';
import { useT } from '../../../i18n/uiLanguage';
import { useWorkbenchStore } from '../../workbenchStore';

const INPUT_CLASS = 'w-[90px] rounded-[4px] border border-mg-border bg-transparent px-[6px] py-[2px] text-[11.5px] text-mg-body';

// Punto 23 (D2): soltar el proceso del agente de una pestaña inactiva y fuera de la vista. 0 = nunca.
// Campo numérico que se aplica al perder el foco o con Enter. Un valor que la acción rechaza vuelve al anterior.
export function IdleCloseSection(): React.JSX.Element {
  const t = useT();
  const stored = useWorkbenchStore((s) => s.settings.idleCloseMinutes);
  const setIdleCloseMinutes = useWorkbenchStore((s) => s.setIdleCloseMinutes);
  const [draft, setDraft] = useState(String(stored));
  useEffect(() => setDraft(String(stored)), [stored]);

  const apply = (): void => {
    try {
      setIdleCloseMinutes(Number(draft));
    } catch (error) {
      console.warn(`Inactividad: valor rechazado: ${JSON.stringify(draft)}`, error);
      setDraft(String(stored));
    }
  };

  return (
    <div data-setting="idle-close" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
        <input
          type="number"
          className={INPUT_CLASS}
          min={IDLE_CLOSE_LIMITS.min}
          max={IDLE_CLOSE_LIMITS.max}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span>
          <span className="font-semibold">{t('settings.idleClose.label')}</span>
          <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.idleClose.hint')}</span>
        </span>
      </label>
    </div>
  );
}
