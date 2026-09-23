import { useEffect, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { Hint } from './TranscriptHint';
import { PermissionDecisionButtons } from './PermissionDecisionButtons';
import type { PermissionRule, SettingsOrigin } from '@shared/ipc';
import type { PermissionView } from '../types';

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

const ORIGIN_LABEL: Readonly<Record<SettingsOrigin, string>> = {
  account: 'cuenta',
  project: 'proyecto',
  projectLocal: 'proyecto (local)',
  mageCommon: 'Mage (común)',
};

const EFFECT_SKIN: Readonly<Record<PermissionRule['effect'], { readonly label: string; readonly clase: string }>> = {
  deny: { label: 'denegar', clase: 'text-mg-danger' },
  ask: { label: 'preguntar', clase: 'text-mg-warn-text' },
  allow: { label: 'permitir', clase: 'text-mg-diff-add' },
};

const MODE_LABEL: Readonly<Record<string, string>> = {
  default: 'Manual: pide permiso para cada acción',
  acceptEdits: 'Auto-editar: acepta ediciones dentro de la carpeta',
  plan: 'Plan: el agente no ejecuta escrituras',
};

export function PermissionPanel(): React.JSX.Element {
  // La pestaña de ESTE panel, no la activa: con el centro dividido, el inspector de la derecha describe
  // la conversacion del panel al que pertenece.
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const permission = useWorkbenchStore((s) => s.permissionByChat[tabId] ?? null);
  const revoke = useWorkbenchStore((s) => s.revokeAlwaysAllow);
  const focusChat = useWorkbenchStore((s) => s.focusPrompt);
  // ¿La peticion pendiente es una PREGUNTA (2.3)? Entonces se contesta en su tarjeta del chat, y este
  // panel NO puede ofrecer Permitir/Denegar: es el MISMO can_use_tool y contestarlo dos veces hace que
  // `AgentSession.answerPermission` lance ("Permiso desconocido o ya resuelto") y la pestaña se vaya a
  // error. Esto es lo que hace ESTRUCTURALMENTE imposible la doble respuesta, no una convencion.
  const pendingQuestion = useWorkbenchStore((s) => {
    const pending = s.pendingByChat[tabId];
    if (pending === null || pending === undefined) return false;
    const blocks = s.blocksByChat[tabId] ?? [];
    return blocks.some((b) => b.kind === 'question' && b.requestId === pending.requestId && b.state === 'pending');
  });

  return (
    // Ancla ESTABLE para `pnpm verify:gui`: la tarjeta del chat y el panel ofrecen los MISMOS botones
    // con el mismo nombre accesible, asi que sin un ambito por el que anclar, un selector global
    // devuelve siempre el de la tarjeta (que va antes en el DOM) y el panel se mide como si no
    // existiera. No la usa ningun codigo de produccion.
    <div data-permissions-panel="true" className="flex min-h-0 flex-col overflow-y-auto">
      {permission !== null && pendingQuestion && (
        <div className="flex flex-col gap-[10px] border-b border-mg-border-subtle p-[14px] text-[12px] leading-[1.5] text-mg-body2">
          <div>
            El agente ha hecho una <strong>pregunta</strong>: se contesta en la tarjeta del chat.
          </div>
          <button
            onClick={focusChat}
            className="self-start rounded-[7px] border border-mg-border-emph px-[11px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
          >
            Ir a la conversación
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

      {permission === null && <Hint text="Sin permisos pendientes. Abajo, lo que esta conversación tiene configurado." />}

      {tab !== undefined && (
        <ConfiguredPermissions
          cwd={tab.cwd}
          accountDir={tab.resolvedConfigDir ?? tab.accountId}
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
  permissionMode,
  alwaysAllowTools,
  onRevoke,
}: {
  readonly cwd: string;
  readonly accountDir: string;
  readonly permissionMode: string;
  readonly alwaysAllowTools: readonly string[];
  readonly onRevoke: (toolName: string) => void;
}): React.JSX.Element {
  const [rules, setRules] = useState<readonly PermissionRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Se leen al abrir el panel y al cambiar de conversacion. No hay refresco automatico: son ficheros
  // que cambian a mano, y sondearlos seria I/O constante para un dato casi inmovil — por eso hay boton.
  useEffect(() => {
    let cancelled = false;
    setRules(null);
    setError(null);
    void window.mage
      .readEffectiveSettings({ cwd, accountDir })
      .then((settings) => {
        if (!cancelled) setRules(settings.rules);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, accountDir]);

  return (
    <div className="flex flex-col gap-[14px] p-[14px]">
      <section className="flex flex-col gap-[5px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">Modo de permiso</h3>
        <p className="text-[11.5px] leading-[1.5] text-mg-body2">{MODE_LABEL[permissionMode] ?? permissionMode}</p>
        <p className="text-[10.5px] text-mg-muted">Se cambia con el chip del input o con Shift+Tab.</p>
      </section>

      <section className="flex flex-col gap-[5px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">
          Permitido siempre en esta conversación ({alwaysAllowTools.length})
        </h3>
        {alwaysAllowTools.length === 0 ? (
          <p className="text-[11.5px] text-mg-muted">
            Nada. Con «Permitir siempre» en una tarjeta de permiso, esa herramienta deja de preguntar aquí.
          </p>
        ) : (
          <ul className="flex flex-col gap-[3px]">
            {alwaysAllowTools.map((toolName) => (
              <li key={toolName} className="flex items-center gap-[8px] rounded-[6px] bg-mg-tool p-[5px_8px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mg-body">{toolName}</span>
                <button
                  onClick={() => onRevoke(toolName)}
                  aria-label={`Revocar el permiso permanente de ${toolName}`}
                  className="shrink-0 rounded-[6px] border border-mg-border-emph px-[7px] py-[1px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
                >
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-[5px]">
        <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">
          Reglas del CLI{rules === null ? '' : ` (${rules.length})`}
        </h3>
        {error !== null && (
          <div role="alert" className="text-[11.5px] text-mg-danger">
            {error}
          </div>
        )}
        {error === null && rules === null && <p className="text-[11.5px] text-mg-muted">Cargando…</p>}
        {rules !== null && rules.length === 0 && (
          <p className="text-[11.5px] text-mg-muted">Ninguna en los settings de la cuenta, del proyecto ni de Mage.</p>
        )}
        {rules !== null && rules.length > 0 && (
          <ul className="flex flex-col gap-[3px]">
            {rules.map((rule, index) => (
              <li key={`${rule.origin}-${rule.effect}-${rule.pattern}-${index}`} className="flex items-baseline gap-[7px] text-[11px]">
                <span className={`shrink-0 font-semibold ${EFFECT_SKIN[rule.effect].clase}`}>{EFFECT_SKIN[rule.effect].label}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-mg-body2">{rule.pattern}</span>
                <span className="shrink-0 text-[10px] text-mg-muted">{ORIGIN_LABEL[rule.origin]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10.5px] text-mg-muted">
          Salen de los <span className="font-mono">settings.json</span> del CLI. Mage no los reescribe; se editan en Ajustes.
        </p>
      </section>
    </div>
  );
}
