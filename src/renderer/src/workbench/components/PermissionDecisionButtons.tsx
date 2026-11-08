import { isPermissionSending, useWorkbenchStore } from '../workbenchStore';
import type { PermissionDecision, PermissionScope } from '@shared/events';
import { usePaneTabId } from '../paneContext';
import { useT } from '../../i18n/uiLanguage';

// Las CUATRO decisiones de un permiso (esta vez, esta sesión, siempre y denegar), en un solo sitio (2.3b). Las pintan la
// tarjeta del chat (PermissionCard) y el panel de Permisos, y son la misma cosa: el mismo can_use_tool, los mismos
// atajos anunciados y la misma semantica.
// «Permitir siempre» no contesta: abre un aviso con la regla y la cuenta, y se confirma ahí.
//
// `aria-label` ESTABLE y separado del contenido: sin el, el nombre accesible sale del texto visible y
// se cuela el numero del atajo ("Permitir1"), que un lector de pantalla lee tal cual y que no hay
// manera de anclar desde fuera (costo varias tandas de verificacion creyendo que el boton no estaba).

export interface PermissionKeys {
  readonly allow: string | null;
  readonly allowSession: string | null;
  readonly allowAlways: string | null;
  readonly deny: string | null;
}

const DEFAULT_KEYS: PermissionKeys = { allow: '1', allowSession: '2', allowAlways: '3', deny: '4' };

export function PermissionDecisionButtons({
  toolLabel,
  requestId,
  allowScopes,
  rule,
  compact = false,
  keys = DEFAULT_KEYS,
}: {
  readonly toolLabel: string;
  // Alcances que admite la petición (los decide main) y la regla de «siempre», para su aviso.
  readonly allowScopes: readonly PermissionScope[];
  readonly rule: string | null;
  // La peticion que contestan. La tarjeta pasa la SUYA: con varias en cola (tools en paralelo), cada
  // tarjeta decide sobre su can_use_tool. Sin ella (panel), la primera de la cola.
  readonly requestId?: string;
  // En la tarjeta del chat los botones van en FILA: una primaria, una secundaria y Denegar como texto.
  readonly compact?: boolean;
  // Las teclas EFECTIVAS de las tres acciones (las reasignables del catalogo); null = sin tecla. La tarjeta las
  // pasa (usePermissionKeys); no se leen aqui porque este modulo cuelga del panel de Permisos, que el registro
  // de paneles importa, y el catalogo de atajos importa ese registro: un ciclo.
  readonly keys?: PermissionKeys;
}): React.JSX.Element {
  const tabId = usePaneTabId();
  const answerFor = useWorkbenchStore((s) => s.answerPermissionFor);
  // La respuesta va de camino a main: los botones se desactivan hasta que `permission_resolved` cierre la tarjeta.
  const sending = useWorkbenchStore((s) => isPermissionSending(s, tabId, requestId));
  const answer = (decision: PermissionDecision): void => answerFor(tabId, decision, requestId);
  const headRequestId = useWorkbenchStore((s) => s.pendingByChat[tabId]?.[0]?.requestId);
  const ownRequestId = requestId ?? headRequestId;
  const alwaysOpen = useWorkbenchStore((s) => ownRequestId !== undefined && s.alwaysPromptByChat[tabId] === ownRequestId);
  const account = useWorkbenchStore((s) => s.tabs.find((tab) => tab.id === tabId)?.accountAlias ?? '');
  const requestAlways = useWorkbenchStore((s) => s.requestAlwaysAllow);
  const confirmAlways = useWorkbenchStore((s) => s.confirmAlwaysAllow);
  const cancelAlways = useWorkbenchStore((s) => s.cancelAlwaysAllow);
  const shownRule = rule ?? toolLabel;
  const t = useT();
  return (
    <div
      aria-busy={sending}
      data-permission-sending={sending ? 'true' : undefined}
      className={compact ? 'flex flex-wrap items-center gap-[6px] text-[11.5px]' : 'flex flex-col gap-[6px] text-[12px]'}
    >
      <Option shortcut={keys.allow} label={t('chat.permission.allow')} primary compact={compact} disabled={sending} onClick={() => answer({ behavior: 'allow' })}>
        {t('i3.permission.allowOnce')}
      </Option>
      {allowScopes.includes('session') && (
        <Option shortcut={keys.allowSession} label={t('i3.permission.allowSessionAria', { tool: toolLabel })} compact={compact} disabled={sending} onClick={() => answer({ behavior: 'allow', scope: 'session' })}>
          {t('i3.permission.allowSession')}
        </Option>
      )}
      {allowScopes.includes('always') && (
        <Option shortcut={keys.allowAlways} label={t('i3.permission.allowAlwaysAria', { rule: shownRule })} compact={compact} disabled={sending} onClick={() => requestAlways(tabId, ownRequestId)}>
          {t('i3.permission.allowAlways')}
        </Option>
      )}
      <Option
        shortcut={keys.deny}
        deny
        label={t('chat.permission.denyAria')}
        compact={compact}
        disabled={sending}
        onClick={() => answer({ behavior: 'deny', message: 'Denegado por el usuario' })}
      >
        {t('chat.permission.deny')}
      </Option>
      {alwaysOpen && (
        <div role="alert" data-permission-always-warning="true" className="basis-full rounded-[7px] border border-mg-danger bg-mg-block p-[8px_10px] text-[11.5px] leading-[1.5] text-mg-body2">
          <p>{t('i3.permission.alwaysWarning', { rule: shownRule, account })}</p>
          <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
            <button type="button" data-permission-always-confirm="true" disabled={sending} onClick={() => confirmAlways(tabId)} className="rounded-[7px] border border-mg-danger px-[10px] py-[4px] font-semibold text-mg-danger hover:bg-mg-hover disabled:opacity-50">
              {t('i3.permission.alwaysConfirm')}
            </button>
            <button type="button" onClick={() => cancelAlways(tabId)} className="rounded-[7px] px-[10px] py-[4px] text-mg-sec hover:bg-mg-hover hover:text-mg-body">
              {t('i3.permission.alwaysCancel')}
            </button>
          </div>
        </div>
      )}
      {sending && <span className="text-[11px] text-mg-muted">{t('chat.permission.sending')}</span>}
    </div>
  );
}

function Option({
  shortcut,
  label,
  primary = false,
  deny = false,
  compact,
  disabled,
  onClick,
  children,
}: {
  readonly shortcut: string | null;
  readonly label: string;
  readonly primary?: boolean;
  readonly deny?: boolean;
  readonly compact: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const base = compact
    ? 'flex items-center gap-[6px] rounded-[7px] px-[10px] py-[4px]'
    : 'flex items-center justify-between rounded-[7px] p-[8px_12px]';
  // En la tarjeta compacta "Denegar" es un boton de texto: una primaria, una secundaria y esa (Q-U3).
  const textOnly = compact && deny;
  const primarySkin = 'bg-mg-primary font-semibold text-mg-primary-ink';
  const secondarySkin = 'border border-mg-border-emph text-mg-body2 hover:bg-mg-hover';
  const textSkin = 'text-mg-sec underline-offset-2 hover:text-mg-body hover:underline';
  const filledSkin = primary ? primarySkin : secondarySkin;
  const skin = textOnly ? textSkin : filledSkin;
  const keyClass = compact ? 'font-mono text-[10.5px] opacity-60' : 'font-mono text-[10.5px] opacity-50';
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} aria-keyshortcuts={shortcut ?? undefined} className={`${base} ${skin} disabled:cursor-default disabled:opacity-50`}>
      <span>{children}</span>
      {shortcut !== null && (
        <span aria-hidden="true" className={keyClass}>
          {shortcut}
        </span>
      )}
    </button>
  );
}
