import { useEffect, useState } from 'react';
import { headPermission, useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { hasPendingQuestion } from '../engineBlocks';
import { Hint } from './TranscriptHint';
import { PermissionDecisionButtons } from './PermissionDecisionButtons';
import type { PermissionRule, SettingsOrigin } from '@shared/ipc';
import type { PermissionView } from '../types';
import { useT } from '../../i18n/uiLanguage';
import { describeError } from '../describeError';

// Panel "Permiso" del inspector. Tiene DOS trabajos, y el segundo es nuevo (2.3b):
//
//  1. El DETALLE de la peticion pendiente: el diff completo de lo que se va a escribir. Es lo que abre
//     el enlace "Más información" de la tarjeta del chat — la tarjeta decide, el panel explica.
//  2. Los permisos CONFIGURADOS de esta conversacion (peticion del usuario): el modo de permiso, las
//     reglas "Permitir siempre aqui" que Mage guarda por conversacion (con su boton de revocar) y las
//     reglas del propio CLI, etiquetadas con el fichero del que salen.
//
// Los botones de decidir viven en `PermissionDecisionButtons`, compartidos con la tarjeta del chat: son
// la misma decision sobre el mismo can_use_tool y ya habian divergido una vez.

// Las tres tablas guardan la CLAVE del catálogo: se traduce al pintar.
const ORIGIN_LABEL = {
  account: 'chat.permissions.origin.account',
  project: 'chat.permissions.origin.project',
  projectLocal: 'chat.permissions.origin.projectLocal',
  mageCommon: 'chat.permissions.origin.mageCommon',
} as const satisfies Readonly<Record<SettingsOrigin, string>>;

const EFFECT_SKIN = {
  deny: { label: 'chat.permissions.effect.deny', clase: 'text-mg-danger' },
  ask: { label: 'chat.permissions.effect.ask', clase: 'text-mg-warn-text' },
  allow: { label: 'chat.permissions.effect.allow', clase: 'text-mg-diff-add' },
} as const satisfies Readonly<Record<PermissionRule['effect'], { readonly label: string; readonly clase: string }>>;

const MODE_LABEL = {
  default: 'chat.permissions.mode.default',
  acceptEdits: 'chat.permissions.mode.acceptEdits',
  plan: 'chat.permissions.mode.plan',
  auto: 'chat.permissions.mode.auto',
  bypassPermissions: 'chat.permissions.mode.bypassPermissions',
} as const;

type ModeLabelKey = (typeof MODE_LABEL)[keyof typeof MODE_LABEL];

// Etiqueta de un modo de permiso; uno que Mage no conoce se pinta con su nombre crudo.
function modeLabelKey(mode: string): ModeLabelKey | undefined {
  return Object.hasOwn(MODE_LABEL, mode) ? MODE_LABEL[mode as keyof typeof MODE_LABEL] : undefined;
}

export function PermissionPanel(): React.JSX.Element {
  // La pestaña de ESTE panel, no la activa: con el centro dividido, el inspector de la derecha describe
  // la conversacion del panel al que pertenece.
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const permission = useWorkbenchStore((s) => headPermission(s, tabId)?.view ?? null);
  const revoke = useWorkbenchStore((s) => s.revokeAlwaysAllow);
  const focusChat = useWorkbenchStore((s) => s.focusPrompt);
  // ¿La peticion pendiente es una PREGUNTA (2.3)? Entonces se contesta en su tarjeta del chat, y este
  // panel NO puede ofrecer Permitir/Denegar: es el MISMO can_use_tool y contestarlo dos veces hace que
  // `AgentSession.answerPermission` lance ("Permiso desconocido o ya resuelto") y la pestaña se vaya a
  // error. Esto es lo que hace ESTRUCTURALMENTE imposible la doble respuesta, no una convencion.
  const pendingQuestion = useWorkbenchStore((s) => hasPendingQuestion(headPermission(s, tabId), s.blocksByChat[tabId] ?? []));
  const t = useT();

  return (
    // Ancla ESTABLE para `pnpm verify:gui`: la tarjeta del chat y el panel ofrecen los MISMOS botones
    // con el mismo nombre accesible, asi que sin un ambito por el que anclar, un selector global
    // devuelve siempre el de la tarjeta (que va antes en el DOM) y el panel se mide como si no
    // existiera. No la usa ningun codigo de produccion.
    <div data-permissions-panel="true" className="flex min-h-0 flex-col overflow-y-auto">
      {permission !== null && pendingQuestion && (
        <div className="flex flex-col gap-[10px] border-b border-mg-border-subtle p-[14px] text-[12px] leading-[1.5] text-mg-body2">
          <div>
            {t('chat.permissions.question.start')} <strong>{t('chat.permissions.question.emphasis')}</strong>
            {t('chat.permissions.question.end')}
          </div>
          <button
            onClick={focusChat}
            className="self-start rounded-[7px] border border-mg-border-emph px-[11px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
          >
            {t('chat.permissions.goToChat')}
          </button>
        </div>
      )}

      {permission !== null && !pendingQuestion && (
        <div className="flex flex-col gap-[11px] border-b border-mg-border-subtle p-[14px]">
          <div className="text-[12px] leading-[1.5] text-mg-body2">{permission.prompt}</div>
          <PermissionDiff permission={permission} />
          <PermissionDecisionButtons toolLabel={permission.toolLabel} />
        </div>
      )}

      {permission === null && <Hint text={t('chat.permissions.nonePending')} />}

      {tab !== undefined && (
        <ConfiguredPermissions
          cwd={tab.cwd}
          accountDir={tab.resolvedConfigDir ?? tab.accountId}
          provider={tab.provider}
          permissionMode={tab.permissionMode ?? 'default'}
          alwaysAllowTools={tab.alwaysAllowTools ?? []}
          onRevoke={(toolName) => revoke(tab.id, toolName)}
        />
      )}
    </div>
  );
}

function PermissionDiff({ permission }: { readonly permission: PermissionView }): React.JSX.Element {
  const [tool, ...rest] = permission.target.split(' ');
  const path = rest.join(' ');
  return (
    <div className="overflow-hidden rounded-[8px] border border-mg-sel font-mono text-[11px]">
      <div className="overflow-x-auto bg-mg-hover p-[7px_11px] text-mg-body">
        {tool} <span className="text-mg-sec">{path}</span>
      </div>
      <div className="overflow-x-auto bg-mg-code p-[8px_11px] leading-[1.7]">
        {permission.diff.map((line, i) => (
          <div key={i} className={line.sign === '+' ? 'text-mg-body' : 'text-mg-muted'}>
            {line.sign} {line.text}
          </div>
        ))}
        <div className="text-mg-ter">{permission.summary}</div>
      </div>
    </div>
  );
}

// Lo que esta conversacion tiene CONFIGURADO. Dos origenes distintos y se dicen como tales: las reglas
// de Mage (por conversacion, revocables aqui) y las del CLI (de sus ficheros de settings, que Mage NO
// reescribe — para eso esta la seccion de Ajustes).
function ConfiguredPermissions({
  cwd,
  accountDir,
  provider,
  permissionMode,
  alwaysAllowTools,
  onRevoke,
}: {
  readonly cwd: string;
  readonly accountDir: string;
  readonly provider: string;
  readonly permissionMode: string;
  readonly alwaysAllowTools: readonly string[];
  readonly onRevoke: (toolName: string) => void;
}): React.JSX.Element {
  const [rules, setRules] = useState<readonly PermissionRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const modeKey = modeLabelKey(permissionMode);

  // Se leen al abrir el panel y al cambiar de conversacion. No hay refresco automatico: son ficheros
  // que cambian a mano, y sondearlos seria I/O constante para un dato casi inmovil — por eso hay boton.
  useEffect(() => {
    let cancelled = false;
    setRules(null);
    setError(null);
    if (provider !== 'claude') return;
    void window.mage
      .readEffectiveSettings({ cwd, accountDir })
      .then((settings) => {
        if (!cancelled) setRules(settings.rules);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? describeError(err) : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, accountDir, provider]);

  return (
    <div className="flex flex-col gap-[14px] p-[14px]">
      {provider !== 'claude' && <p className="text-[11px] text-mg-muted">{t('chat.permissions.otherProvider', { provider })}</p>}
      <section className="flex flex-col gap-[5px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">{t('chat.permissions.mode.title')}</h3>
        <p className="text-[11.5px] leading-[1.5] text-mg-body2">{modeKey === undefined ? permissionMode : t(modeKey)}</p>
        <p className="text-[10.5px] text-mg-muted">{t('chat.permissions.mode.hint')}</p>
      </section>

      <section className="flex flex-col gap-[5px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">
          {t('chat.permissions.alwaysAllowed.title', { count: alwaysAllowTools.length })}
        </h3>
        {alwaysAllowTools.length === 0 ? (
          <p className="text-[11.5px] text-mg-muted">
            {t('chat.permissions.alwaysAllowed.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-[3px]">
            {alwaysAllowTools.map((toolName) => (
              <li key={toolName} className="flex items-center gap-[8px] rounded-[6px] bg-mg-tool p-[5px_8px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mg-body">{toolName}</span>
                <button
                  onClick={() => onRevoke(toolName)}
                  aria-label={t('chat.permissions.alwaysAllowed.revokeAria', { tool: toolName })}
                  className="shrink-0 rounded-[6px] border border-mg-border-emph px-[7px] py-[1px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
                >
                  {t('chat.permissions.alwaysAllowed.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-[5px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">
          {rules === null ? t('chat.permissions.cliRules.title') : t('chat.permissions.cliRules.titleCount', { count: rules.length })}
        </h3>
        {error !== null && (
          <div role="alert" className="text-[11.5px] text-mg-danger">
            {error}
          </div>
        )}
        {error === null && rules === null && <p className="text-[11.5px] text-mg-muted">{t('chat.permissions.cliRules.loading')}</p>}
        {rules !== null && rules.length === 0 && (
          <p className="text-[11.5px] text-mg-muted">{t('chat.permissions.cliRules.empty')}</p>
        )}
        {rules !== null && rules.length > 0 && (
          <ul className="flex flex-col gap-[3px]">
            {rules.map((rule, index) => (
              <li key={`${rule.origin}-${rule.effect}-${rule.pattern}-${index}`} className="flex items-baseline gap-[7px] text-[11px]">
                <span className={`shrink-0 font-semibold ${EFFECT_SKIN[rule.effect].clase}`}>{t(EFFECT_SKIN[rule.effect].label)}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-mg-body2">{rule.pattern}</span>
                <span className="shrink-0 text-[10px] text-mg-muted">{t(ORIGIN_LABEL[rule.origin])}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10.5px] text-mg-muted">
          {t('chat.permissions.cliRules.sourceStart')} <span className="font-mono">settings.json</span> {t('chat.permissions.cliRules.sourceEnd')}
        </p>
      </section>
    </div>
  );
}
