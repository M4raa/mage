import { useEffect, useState } from 'react';
import { useWorkbenchStore } from '../../workbenchStore';
import { useSharedConfigStore } from '../../sharedConfigStore';
import { CommonRulesEditor } from './CommonRulesEditor';
import type { EffectiveSettings, HookEntry, PermissionRule, SettingsOrigin } from '@shared/ipc';
import { useT } from '../../../i18n/uiLanguage';

// Seccion "Hooks y permisos" (2.9.b). Los dos salen del MISMO fichero y por eso comparten pantalla:
// `settings-common.json` esta restringido por forma a exactamente `hooks` y `permissions.allow/deny`.
//
// Lo que se enseña arriba es la UNION de las cuatro fuentes, cada regla ETIQUETADA con su origen. Es
// un dato medido: el CLI CONCATENA hooks y `permissions.allow` entre fuentes, no los pisa — fingir
// una precedencia seria mentir sobre lo que va a pasar.
//
// Solo se puede EDITAR la parte de Mage (`settings-common.json`), y ahora se edita AQUI MISMO (bloque
// de abajo) en vez de mandar al usuario a otra seccion a escribir JSON. Los otros tres ficheros son
// del usuario y del proyecto: se muestran, no se tocan.
// La etiqueta es la CLAVE del catalogo: se traduce al pintar.
const ORIGIN_LABEL = {
  account: 'settings.hooks.origin.account',
  project: 'settings.hooks.origin.project',
  projectLocal: 'settings.hooks.origin.projectLocal',
  mageCommon: 'settings.hooks.origin.mageCommon',
} as const satisfies Readonly<Record<SettingsOrigin, string>>;

export function HooksPermissionsSection(): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.tabs.find((candidate) => candidate.id === s.activeTabId));
  const loadSharedConfig = useSharedConfigStore((s) => s.load);
  const cwd = tab?.cwd;
  const accountDir = tab === undefined ? undefined : (tab.resolvedConfigDir ?? tab.accountId);
  const [settings, setSettings] = useState<EffectiveSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const mageCommon = t(ORIGIN_LABEL.mageCommon);

  // El editor de abajo trabaja sobre el fichero comun, que vive en otro store: se carga aqui para que
  // la seccion sirva tambien sin haber pasado antes por otra que lo cargue.
  useEffect(() => {
    void loadSharedConfig();
  }, []);

  useEffect(() => {
    setSettings(null);
    setError(null);
    if (cwd === undefined || accountDir === undefined || tab?.provider !== 'claude') return;
    let cancelled = false;
    void window.mage
      .readEffectiveSettings({ cwd, accountDir })
      .then((result) => {
        if (!cancelled) setSettings(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, accountDir, tab?.provider]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11.5px] leading-[1.5] text-mg-muted">
        {t('settings.hooks.intro.start')} <strong>{t('settings.hooks.intro.union')}</strong>{' '}
        {t('settings.hooks.intro.sources', {
          account: t(ORIGIN_LABEL.account),
          project: t(ORIGIN_LABEL.project),
          projectLocal: t(ORIGIN_LABEL.projectLocal),
          mageCommon,
        })}{' '}
        <strong>{t('settings.hooks.intro.readOnly')}</strong>
        {t('settings.hooks.intro.editable')} <strong>{mageCommon}</strong>
        {t('settings.hooks.intro.end')}
      </p>

      {tab !== undefined && tab.provider !== 'claude'
        ? <p className="text-[12px] text-mg-muted">{t('settings.hooks.otherProvider', { provider: tab.provider })}</p>
        : <EffectiveView settings={settings} error={error} hasTab={tab !== undefined} />}

      <div className="flex flex-col gap-[8px] border-t border-mg-border pt-[14px]">
        <h3 className="text-[11px] font-semibold text-mg-body">{t('settings.hooks.editableHeading', { origin: mageCommon })}</h3>
        <p className="text-[10.5px] leading-[1.5] text-mg-muted">
          {t('settings.hooks.storedIn.start')} <code>settings-common.json</code> {t('settings.hooks.storedIn.end')}
        </p>
        <CommonRulesEditor />
      </div>
    </div>
  );
}

// Vista de solo lectura de la union. Sin pestaña activa no hay `cwd` ni cuenta que leer, pero el
// editor de abajo sigue siendo util: por eso esto es un bloque y no un early return de la seccion.
function EffectiveView({
  settings,
  error,
  hasTab,
}: {
  readonly settings: EffectiveSettings | null;
  readonly error: string | null;
  readonly hasTab: boolean;
}): React.JSX.Element {
  const t = useT();
  if (!hasTab) {
    return <p className="text-[12px] text-mg-muted">{t('settings.hooks.noTab')}</p>;
  }
  if (error !== null) {
    return (
      <div role="alert" className="text-[12px] text-mg-danger">
        {error}
      </div>
    );
  }
  if (settings === null) return <p className="text-[12px] text-mg-muted">{t('settings.hooks.loading')}</p>;

  return (
    <div className="flex flex-col gap-[16px]">
      <section className="flex flex-col gap-[6px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">{t('settings.hooks.hooksHeading', { count: settings.hooks.length })}</h3>
        {settings.hooks.length === 0 ? (
          <p className="text-[11.5px] text-mg-muted">{t('settings.hooks.noHooks')}</p>
        ) : (
          <ul className="flex flex-col gap-[3px]">
            {settings.hooks.map((hook, index) => (
              <HookRow key={`${hook.event}-${index}`} hook={hook} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-[6px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">
          {t('settings.hooks.rulesHeading', { count: settings.rules.length })}
        </h3>
        {settings.rules.length === 0 ? (
          <p className="text-[11.5px] text-mg-muted">{t('settings.hooks.noRules')}</p>
        ) : (
          <ul className="flex flex-col gap-[3px]">
            {settings.rules.map((rule, index) => (
              <RuleRow key={`${rule.pattern}-${index}`} rule={rule} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HookRow({ hook }: { readonly hook: HookEntry }): React.JSX.Element {
  return (
    <li className="flex items-baseline gap-[8px] rounded-[6px] p-[4px_7px] text-[11px] hover:bg-mg-hover">
      <span className="flex-none font-bold text-mg-body">{hook.event}</span>
      {hook.matcher !== null && <span className="flex-none font-mono text-[10px] text-mg-ter">{hook.matcher}</span>}
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mg-sec2" title={hook.command}>
        {hook.command}
      </span>
      <OriginTag origin={hook.origin} />
    </li>
  );
}

function RuleRow({ rule }: { readonly rule: PermissionRule }): React.JSX.Element {
  return (
    <li className="flex items-baseline gap-[8px] rounded-[6px] p-[4px_7px] text-[11px] hover:bg-mg-hover">
      <span className={`flex-none font-bold ${rule.effect === 'deny' ? 'text-mg-danger' : 'text-mg-body'}`}>
        {rule.effect === 'deny' ? 'deny' : 'allow'}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mg-sec2">{rule.pattern}</span>
      <OriginTag origin={rule.origin} />
    </li>
  );
}

// Chip de origen. SIN fondo propio a proposito: `--color-mg-sel` lo mapea un tema importado desde
// `list.activeSelectionBackground` (a menudo un color saturado) mientras el texto salia de
// `--color-mg-ter` (`descriptionForeground`), y con algunos temas el par quedaba ilegible —el chip se
// veia, el texto no—. Un contorno sobre el fondo del panel no puede tapar su propio texto: el borde
// es un token de BORDE y el texto usa el mismo color de cuerpo que el resto de la fila, que todo tema
// resuelve contra ese mismo fondo.
function OriginTag({ origin }: { readonly origin: SettingsOrigin }): React.JSX.Element {
  const editable = origin === 'mageCommon';
  const t = useT();
  return (
    <span
      title={editable ? t('settings.hooks.editableTip') : t('settings.hooks.readOnlyTip')}
      className={`flex-none rounded-[4px] border px-[5px] py-[1px] text-[9px] ${
        editable ? 'border-mg-border-pop text-mg-body2' : 'border-mg-border-ctrl text-mg-sec'
      }`}
    >
      {t(ORIGIN_LABEL[origin])}
    </span>
  );
}
