import { useEffect, useState } from 'react';
import { useWorkbenchStore } from '../../workbenchStore';
import { useSharedConfigStore } from '../../sharedConfigStore';
import { CommonRulesEditor } from './CommonRulesEditor';
import type { EffectiveSettings, HookEntry, PermissionRule, SettingsOrigin } from '@shared/ipc';

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
const ORIGIN_LABEL: Readonly<Record<SettingsOrigin, string>> = {
  account: 'cuenta',
  project: 'proyecto',
  projectLocal: 'proyecto (local)',
  mageCommon: 'Mage (común)',
};

export function HooksPermissionsSection(): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const loadSharedConfig = useSharedConfigStore((s) => s.load);
  const cwd = tab?.cwd;
  const accountDir = tab === undefined ? undefined : (tab.resolvedConfigDir ?? tab.accountId);
  const [settings, setSettings] = useState<EffectiveSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        Arriba ves la <strong>unión</strong> de las cuatro fuentes ({ORIGIN_LABEL.account}, {ORIGIN_LABEL.project},{' '}
        {ORIGIN_LABEL.projectLocal} y {ORIGIN_LABEL.mageCommon}): el CLI las concatena, no las pisa. Lo que viene del
        CLI o del proyecto se muestra <strong>solo para consultar</strong>; desde Mage únicamente se edita lo de{' '}
        <strong>{ORIGIN_LABEL.mageCommon}</strong>, en el bloque del final.
      </p>

      {tab !== undefined && tab.provider !== 'claude'
        ? <p className="text-[12px] text-mg-muted">Los hooks y permisos efectivos de {tab.provider} se consultan en su CLI.</p>
        : <EffectiveView settings={settings} error={error} hasTab={tab !== undefined} />}

      <div className="flex flex-col gap-[8px] border-t border-mg-border pt-[14px]">
        <h3 className="text-[11px] font-semibold text-mg-body">Editable desde Mage — {ORIGIN_LABEL.mageCommon}</h3>
        <p className="text-[10.5px] leading-[1.5] text-mg-muted">
          Se guarda en <code>settings-common.json</code> y se aplica a todas las cuentas. Los cambios se ven arriba la
          próxima vez que se lea la conversación.
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
  if (!hasTab) {
    return <p className="text-[12px] text-mg-muted">Abre una conversación para ver los hooks y reglas efectivos.</p>;
  }
  if (error !== null) {
    return (
      <div role="alert" className="text-[12px] text-mg-danger">
        {error}
      </div>
    );
  }
  if (settings === null) return <p className="text-[12px] text-mg-muted">Cargando…</p>;

  return (
    <div className="flex flex-col gap-[16px]">
      <section className="flex flex-col gap-[6px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">Hooks ({settings.hooks.length})</h3>
        {settings.hooks.length === 0 ? (
          <p className="text-[11.5px] text-mg-muted">No hay ningún hook configurado en las cuatro fuentes.</p>
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
          Reglas de permisos ({settings.rules.length})
        </h3>
        {settings.rules.length === 0 ? (
          <p className="text-[11.5px] text-mg-muted">No hay ninguna regla de permisos configurada.</p>
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
  return (
    <span
      title={editable ? 'Editable desde Mage' : 'Solo lectura: lo gestiona el CLI o el proyecto'}
      className={`flex-none rounded-[4px] border px-[5px] py-[1px] text-[9px] ${
        editable ? 'border-mg-border-pop text-mg-body2' : 'border-mg-border-ctrl text-mg-sec'
      }`}
    >
      {ORIGIN_LABEL[origin]}
    </span>
  );
}
