import { useT } from '../../i18n/uiLanguage';
import { useWorkbenchStore } from '../workbenchStore';
import { ACCOUNT_AVATARS_PLACEMENTS, SEPARATOR_CONTRASTS, type AccountAvatarsPlacement, type SeparatorContrast } from '@shared/settings';
import type { MessageKey, MessageValues } from '@shared/i18n/messageKeys.generated';

// Solo claves de texto fijo (sin valores que interpolar): lo que un rótulo de opción necesita.
type PlainKey = { [K in MessageKey]: [MessageValues[K]] extends [never] ? K : never }[MessageKey];

export interface AppearanceChoiceOption<T extends string> {
  readonly value: T;
  readonly label: PlainKey;
}

// Control de Configuración › Apariencia de dos o tres valores: la misma tarjeta de opción que el selector de idioma y
// el de tema base, para que los ajustes nuevos no inventen otra.
export function AppearanceChoice<T extends string>({
  setting,
  label,
  options,
  value,
  onChange,
}: {
  readonly setting: string;
  readonly label: PlainKey;
  readonly options: readonly AppearanceChoiceOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[8px]" data-setting={setting}>
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t(label)}</span>
      <div className="flex gap-[8px]" role="radiogroup" aria-label={t(label)}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              role="radio"
              aria-checked={selected}
              data-choice={option.value}
              onClick={() => onChange(option.value)}
              className={`flex-1 rounded-[8px] border px-[12px] py-[10px] text-left ${
                selected ? 'border-mg-focus bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'border-mg-border-ctrl text-mg-body2 hover:bg-mg-hover'
              }`}
            >
              <div className="text-[12px] font-semibold">{t(option.label)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const AVATARS_LABEL: Readonly<Record<AccountAvatarsPlacement, PlainKey>> = {
  top: 'settings.appearance.avatars.top',
  rail: 'settings.appearance.avatars.rail',
};
const SEPARATOR_LABEL: Readonly<Record<SeparatorContrast, PlainKey>> = {
  soft: 'settings.appearance.separatorContrast.soft',
  normal: 'settings.appearance.separatorContrast.normal',
  strong: 'settings.appearance.separatorContrast.strong',
};

// «Avatares de cuenta: Arriba / En el lateral» (U1).
export function AvatarsPlacementControl(): React.JSX.Element {
  const value = useWorkbenchStore((s) => s.settings.accountAvatarsPlacement);
  const onChange = useWorkbenchStore((s) => s.setAccountAvatarsPlacement);
  return (
    <AppearanceChoice
      setting="account-avatars-placement"
      label="settings.appearance.avatars.label"
      options={ACCOUNT_AVATARS_PLACEMENTS.map((placement) => ({ value: placement, label: AVATARS_LABEL[placement] }))}
      value={value}
      onChange={onChange}
    />
  );
}

// «Contraste de separaciones: Suave / Normal / Marcado» (U7).
export function SeparatorContrastControl(): React.JSX.Element {
  const value = useWorkbenchStore((s) => s.settings.separatorContrast);
  const onChange = useWorkbenchStore((s) => s.setSeparatorContrast);
  return (
    <AppearanceChoice
      setting="separator-contrast"
      label="settings.appearance.separatorContrast.label"
      options={SEPARATOR_CONTRASTS.map((level) => ({ value: level, label: SEPARATOR_LABEL[level] }))}
      value={value}
      onChange={onChange}
    />
  );
}
