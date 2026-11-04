import { useLocalPopover } from '../../localPopovers';
import { useState } from 'react';
import { Icon } from '../Icon';
import { RotatingChevron } from '../AnimatedIcon';
import { useWorkbenchStore } from '../../workbenchStore';
import { projectSummary, type ProjectGroup, type RowIndicator, type SidebarRow } from '../../sidebarModel';
import { useT } from '../../../i18n/uiLanguage';

// Nº de conversaciones visibles por grupo antes de «mostrar más» (#1 de AJUSTES) y tamaño del incremento de
// cada pulsación: se revela DE 10 EN 10, no todo de golpe (feedback GUI A1).
export const COLLAPSED_LIMIT = 5;
export const REVEAL_STEP = 10;

export function SectionLabel({ text, hint }: { readonly text: string; readonly hint?: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-[6px] p-[10px_6px_4px] text-[10.5px] font-semibold uppercase tracking-[.06em] text-mg-ter">
      {text}
      {hint !== undefined && <span className="ml-auto truncate font-normal normal-case tracking-normal text-mg-muted">{hint}</span>}
    </div>
  );
}

interface RowListProps {
  readonly rows: readonly SidebarRow[];
  readonly renderRow: (row: SidebarRow) => React.ReactNode;
  // Sin tope: con un filtro o una búsqueda activos (la lista ya viene reducida) o en las fijadas.
  readonly unlimited: boolean;
}

// Filas con el tope de 5 y «Mostrar N más» de 10 en 10.
export function RowList({ rows, renderRow, unlimited }: RowListProps): React.JSX.Element {
  const t = useT();
  const [limit, setLimit] = useState(COLLAPSED_LIMIT);
  const visible = unlimited ? rows : rows.slice(0, limit);
  const hidden = rows.length - visible.length;
  const moreClass = 'mx-[2px] mt-[2px] rounded-[6px] p-[4px_9px] text-left text-[11px] text-mg-icon transition-colors duration-90 ease-out hover:bg-mg-hover hover:text-mg-body';
  return (
    <>
      {visible.map(renderRow)}
      {/* data-volatile-text: «Mostrar N más» depende del historial REAL; verify:gui --dump-dom-text no lo vuelca */}
      {!unlimited && hidden > 0 && (
        <button onClick={() => setLimit((current) => current + REVEAL_STEP)} data-volatile-text="true" className={moreClass}>
          {t('sidebar.section.showMore', { count: Math.min(hidden, REVEAL_STEP) })} <span className="text-mg-muted">{t('sidebar.section.remaining', { count: hidden })}</span>
        </button>
      )}
      {!unlimited && limit > COLLAPSED_LIMIT && (
        <button onClick={() => setLimit(COLLAPSED_LIMIT)} data-volatile-text="true" className={moreClass}>
          {t('sidebar.section.showLess')}
        </button>
      )}
    </>
  );
}

// Grupo plano (Fijadas, Sin proyecto, Privadas).
export function FlatGroup({ kind, title, rows, renderRow, unlimited }: RowListProps & {
  readonly kind: 'pinned' | 'unassigned' | 'private';
  readonly title: string;
}): React.JSX.Element {
  return (
    <section data-sidebar-group={kind} className="flex flex-col gap-px">
      <SectionLabel text={title} hint={`${rows.length}`} />
      <RowList rows={rows} renderRow={renderRow} unlimited={unlimited} />
    </section>
  );
}

export interface ProjectGroupViewProps {
  readonly group: ProjectGroup;
  readonly renderRow: (row: SidebarRow) => React.ReactNode;
  readonly indicatorOf: (row: SidebarRow) => RowIndicator | null;
  readonly unlimited: boolean;
  // Con un filtro activo se enseñan todos desplegados.
  readonly forceOpen: boolean;
  readonly emptyHint: string;
  readonly onCreate: () => void;
  // Solo en los proyectos del usuario.
  readonly onEdit: (() => void) | null;
  readonly onRemove: (() => void) | null;
}

// Proyecto: cabecera con chevron, carpeta, nombre, resumen (ámbar con el nº que piden algo, anillo si trabaja)
// y nº de conversaciones; «＋» y «⋯» solo con el ratón encima o el foco dentro. Plegado salvo el que contiene la
// pestaña activa; el estado de plegado vive aquí y no se persiste.
export function ProjectGroupView(props: ProjectGroupViewProps): React.JSX.Element {
  const { group, renderRow, indicatorOf, unlimited, forceOpen, emptyHint } = props;
  // Booleano primitivo: solo se vuelve a pintar el grupo cuyo «contiene la activa» cambia al cambiar de pestaña.
  const hasActive = useWorkbenchStore((s) => group.rows.some((row) => row.kind === 'tab' && row.tab.id === s.activeTabId));
  const [override, setOverride] = useState<boolean | null>(null);
  const open = forceOpen || (override ?? hasActive);
  const summary = projectSummary(group.rows.map(indicatorOf));
  return (
    <section data-sidebar-group="project" {...(group.projectId === null ? {} : { 'data-chat-project': group.projectId })} className="flex flex-col gap-px">
      <div className="group/proj flex h-[28px] items-center gap-[2px] rounded-[6px] pr-[4px] hover:bg-mg-hover focus-within:bg-mg-hover">
        <button
          data-project-key={group.key}
          aria-expanded={open}
          onClick={() => setOverride(!open)}
          className="flex h-full min-w-0 flex-1 items-center gap-[6px] p-[0_6px] text-left font-semibold text-mg-body"
        >
          <span aria-hidden="true" className="text-mg-icon"><RotatingChevron open={open} size={12} /></span>
          <Icon name="folder" size={12} />
          <span className="truncate">{group.name}</span>
        </button>
        <span className="flex flex-none items-center gap-[6px] text-[10.5px] font-normal text-mg-muted">
          {summary.attention > 0 && (
            <span data-project-attention={summary.attention} className="rounded-full border border-mg-warn-border bg-mg-warn-bg px-[6px] text-[10px] font-bold text-mg-warn-text">{summary.attention}</span>
          )}
          {summary.working && <span data-project-working="true" aria-hidden="true" className="mg-pulse h-[9px] w-[9px] rounded-full border-[1.5px] border-mg-sec" />}
          <span>{group.rows.length}</span>
        </span>
        <ProjectActions group={group} onCreate={props.onCreate} onEdit={props.onEdit} onRemove={props.onRemove} />
      </div>
      {open && group.rows.length === 0 && <div data-volatile-text="true" className="p-[4px_9px_4px_22px] text-[11px] text-mg-muted">{emptyHint}</div>}
      {open && <RowList rows={group.rows} renderRow={renderRow} unlimited={unlimited} />}
    </section>
  );
}

function ProjectActions({ group, onCreate, onEdit, onRemove }: Pick<ProjectGroupViewProps, 'group' | 'onCreate' | 'onEdit' | 'onRemove'>): React.JSX.Element {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  useLocalPopover(menuOpen);
  const reveal = 'opacity-0 transition-opacity duration-100 ease-out group-hover/proj:opacity-100 group-focus-within/proj:opacity-100 focus-visible:opacity-100';
  const btn = `grid h-[20px] w-[20px] flex-none place-items-center rounded-[4px] text-mg-icon hover:bg-mg-sel hover:text-mg-sel-ink ${reveal}`;
  return (
    <span className="relative flex flex-none items-center" onKeyDown={(e) => e.key === 'Escape' && menuOpen && setMenuOpen(false)}>
      <button onClick={onCreate} aria-label={t('sidebar.projects.newIn', { name: group.name })} className={btn}><Icon name="plus" size={13} /></button>
      {onEdit !== null && onRemove !== null && (
        <>
          <button onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={t('sidebar.projects.moreActions', { name: group.name })} className={btn}>
            <Icon name="ellipsis" size={14} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[40]" onClick={() => setMenuOpen(false)} />
              <div role="menu" className="absolute right-0 top-[22px] z-[41] w-[130px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop">
                <button role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }} aria-label={t('sidebar.projects.editAria', { name: group.name })} className="block w-full px-[10px] py-[5px] text-left hover:bg-mg-hover">{t('sidebar.projects.edit')}</button>
                <button role="menuitem" onClick={() => { setMenuOpen(false); onRemove(); }} aria-label={t('sidebar.projects.removeAria', { name: group.name })} className="block w-full px-[10px] py-[5px] text-left text-mg-danger hover:bg-mg-danger-bg">{t('sidebar.projects.remove')}</button>
              </div>
            </>
          )}
        </>
      )}
    </span>
  );
}
