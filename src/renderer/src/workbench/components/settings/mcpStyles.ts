// Clases compartidas por la seccion «MCP y conectores» y sus dialogos.
export const MCP_BUTTON_CLASS =
  'flex items-center gap-[5px] rounded-[6px] border border-mg-border-emph px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:opacity-50';
export const MCP_PRIMARY_BUTTON_CLASS =
  'rounded-[6px] bg-mg-primary px-[12px] py-[4px] text-[10.5px] font-semibold text-mg-primary-ink disabled:opacity-50';
// Capa del dialogo: `fixed` y por encima de Configuracion (z-50), que es donde vive.
export const MCP_DIALOG_SCRIM_CLASS = 'fixed inset-0 z-[60] flex items-start justify-center bg-mg-scrim p-[48px_24px]';
export const MCP_DIALOG_PANEL_CLASS =
  'flex max-h-full w-[min(620px,100%)] flex-col gap-[10px] overflow-y-auto rounded-[10px] border border-mg-border-pop bg-mg-panel p-[16px] text-[12px] mg-shadow-modal';

// Escape de un dialogo DENTRO de Configuracion: se para aqui para no cerrar las dos capas (el listener
// de Configuracion esta en `document`, que recibe el evento despues de la raiz de React).
export function stopEscape(onClose: () => void): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  };
}
