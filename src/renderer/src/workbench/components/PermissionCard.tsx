import { usePanelLayoutStore } from '../panelLayoutStore';
import { Icon } from './Icon';
import { PermissionDecisionButtons } from './PermissionDecisionButtons';
import { usePermissionKeys } from './usePermissionKeys';
import type { Block } from '../types';
import { useT } from '../../i18n/uiLanguage';

// Tarjeta de PERMISO en el chat (2.3b, peticion del usuario: "en vez de que me salga un mensaje, quiero
// que directamente me salga la accion que se quiere realizar y las acciones de permitir, denegar, etc
// en el propio espacio del chat, y si se quiere mas informacion del comando a ejecutar, entonces se
// abre la herramienta de permisos").
//
// Por eso aqui NO va el diff: la tarjeta dice QUE se va a hacer y ofrece decidir; el detalle completo
// (diff linea a linea, permisos configurados) es lo que abre "Más información" en el panel.
//
// Contestada, la tarjeta se queda en el hilo con la decision. Es el registro de lo que se autorizo, y
// releer una conversacion sin el deja agujeros ("¿esto quien lo permitio?").

// `texto` es la CLAVE del catálogo: se traduce al pintar.
type StateKey = 'chat.permission.state.allowed' | 'chat.permission.state.denied' | 'chat.permission.state.cancelled';

const ESTADO: Readonly<Record<string, { readonly texto: StateKey; readonly clase: string }>> = {
  allowed: { texto: 'chat.permission.state.allowed', clase: 'text-mg-diff-add' },
  denied: { texto: 'chat.permission.state.denied', clase: 'text-mg-danger' },
  cancelled: { texto: 'chat.permission.state.cancelled', clase: 'text-mg-muted' },
};

export function PermissionCard({ block }: { readonly block: Extract<Block, { kind: 'permission' }> }): React.JSX.Element {
  const revealPanel = usePanelLayoutStore((s) => s.revealPanelById);
  const resuelto = ESTADO[block.state];
  const t = useT();
  const keys = usePermissionKeys();

  return (
    <div
      // El `role="group"` con nombre da a la tarjeta una etiqueta propia en el arbol de accesibilidad:
      // sin el, un lector de pantalla lee los tres botones sin decir a que peticion pertenecen.
      role="group"
      aria-label={t('chat.permission.cardAria', { target: block.target })}
      data-permission-card={block.state}
      data-permission-pending={block.state === 'pending' ? 'true' : undefined}
      className={`rounded-[9px] border p-[11px_13px] ${
        block.state === 'pending' ? 'border-mg-warn-border border-l-[3px] border-l-mg-warn bg-mg-warn-bg' : 'border-mg-border-subtle bg-mg-block'
      }`}
    >
      <div className="mb-[7px] flex items-center gap-[7px] text-[10px] font-bold uppercase tracking-[.06em] text-mg-ter">
        <Icon name="lock" />
        <span>{t('chat.permission.title')}</span>
        {resuelto !== undefined && <span className={`font-normal normal-case ${resuelto.clase}`}>· {t(resuelto.texto)}</span>}
      </div>

      <div className="text-[12px] leading-[1.5] text-mg-body2">{block.prompt}</div>
      <div className="mt-[6px] overflow-x-auto rounded-[7px] bg-mg-code p-[7px_10px] font-mono text-[11px] text-mg-body">
        {block.target}
      </div>
      {block.summary.trim().length > 0 && <div className="mt-[5px] text-[10.5px] text-mg-ter">{block.summary}</div>}

      {block.state === 'pending' && (
        <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
          <PermissionDecisionButtons toolLabel={block.toolName} requestId={block.requestId} rememberable={block.rememberable !== false} compact keys={keys} />
          {/* El detalle vive en el panel (decision del usuario): aqui solo el camino hasta el. */}
          <button
            onClick={() => revealPanel('permissions')}
            className="text-[11px] text-mg-sec underline decoration-dotted hover:text-mg-body"
          >
            {t('chat.permission.moreInfo')}
          </button>
        </div>
      )}
    </div>
  );
}
