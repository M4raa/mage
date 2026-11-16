import { useLocalPopover } from '../../localPopovers';
import { useState } from 'react';
import { Icon } from '../Icon';
import { RotatingChevron } from '../AnimatedIcon';
import { projectSummary, type ProjectGroup, type RowIndicator, type SidebarRow } from '../../sidebarModel';
import { useT } from '../../../i18n/uiLanguage';

// Nº de conversaciones visibles por grupo antes de «mostrar más» (#1 de AJUSTES) y tamaño del incremento de
// cada pulsación: se revela DE 10 EN 10, no todo de golpe (feedback GUI A1).
export const COLLAPSED_LIMIT = 5;
export const REVEAL_STEP = 10;
// Proyectos visibles antes de «mostrar más» (P-038 V6): por fecha, el último tocado primero.
export const PROJECTS_COLLAPSED_LIMIT = 10;

export function SectionLabel({ text, hint }: { readonly text: string; readonly hint?: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-[6px] p-[10px_6px_4px] text-[10.5px] font-semibold uppercase tracking-[.06em] text-mg-ter">
      {text}
      {hint !== undefined && <span className="ml-auto truncate font-normal normal-case tracking-normal text-mg-muted">{hint}</span>}
    </div>
  );
}

interface RowListProps<T = SidebarRow> {
  readonly rows: readonly T[];
  readonly renderRow: (row: T) => React.ReactNode;
  // Sin tope: con un filtro o una búsqueda activos (la lista ya viene reducida) o en las fijadas.
  readonly unlimited: boolean;
  // Cuántas se ven plegada (5 conversaciones por grupo; 10 proyectos).
  readonly collapsed?: number;
}

// Filas con el tope (5 por defecto) y «Mostrar N más» de 10 en 10. Sirve también para la lista de proyectos.
export function RowList<T>({ rows, renderRow, unlimited, collapsed = COLLAPSED_LIMIT }: RowListProps<T>): React.JSX.Element {
  const t = useT();
  const [limit, setLimit] = useState(collapsed);
  const visible = unlimited ? rows : rows.slice(0, limit);
  const hidden = rows.length - visible.length;
  const moreClass = 'mx-[2px] mt-[2px] rounded-[6px] p-[4px_9px] text-left text-[11px] text-mg-icon transition-colors duration-90 ease-out hover:bg-mg-hover hover:text-mg-body';
  return (
    <>
      {visible.map((row) => renderRow(row))}
      {/* data-volatile-text: «Mostrar N más» depende del historial REAL; verify:gui --dump-dom-text no lo vuelca */}
      {!unlimited && hidden > 0 && (
        <button onClick={() => setLimit((current) => current + REVEAL_STEP)} data-volatile-text="true" className={moreClass}>
          {t('sidebar.section.showMore', { count: Math.min(hidden, REVEAL_STEP) })} <span className="text-mg-muted">{t('sidebar.section.remaining', { count: hidden })}</span>
        </button>
      )}
      {!unlimited && limit > collapsed && (
        <button onClick={() => setLimit(collapsed)} data-volatile-text="true" className={moreClass}>
          {t('sidebar.section.showLess')}
        </button>
      )}
    </>
  );
}

// Grupo plano (Fijadas, Sin proyecto).
export function FlatGroup({ kind, title, rows, renderRow, unlimited }: RowListProps & {
  readonly kind: 'pinned' | 'unassigned';
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
  readonly descendantIndicatorsOf: (row: SidebarRow) => readonly (RowIndicator | null)[];
  readonly unlimited: boolean;
  // Con un filtro activo se enseñan todos desplegados.
  readonly forceOpen: boolean;
  readonly emptyHint: string;
  readonly onCreate: () => void;
  // Solo en los proyectos del usuario.
  readonly onEdit: (() => void) | null;
  readonly onRemove: (() => void) | null;
  // Reordena: `key` se coloca justo ANTES de `beforeKey` (null = al final).
  readonly onMove: (key: string, beforeKey: string | null) => void;
  // Vecinos en la lista visible, para mover con Alt+↑/↓ (null = no hay).
  readonly neighbors: ProjectNeighbors;
}

export interface ProjectNeighbors {
  readonly prev: string | null;
  readonly next: string | null;
  readonly afterNext: string | null;
}

// Tipo propio del arrastre de una carpeta: las filas de historial llevan `application/x-mage-conversation` y
// ninguna de las dos cosas acepta a la otra.
const PROJECT_DRAG_TYPE = 'application/x-mage-project';

const isProjectDrag = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(PROJECT_DRAG_TYPE);

// Alt+↑/↓ sobre la cabecera: sube o baja la carpeta una posición. Mover reordena los nodos y el navegador
// suelta el foco: se devuelve a la cabecera para poder seguir pulsando.
function moveByKey(e: React.KeyboardEvent<HTMLElement>, key: string, { prev, next, afterNext }: ProjectNeighbors, onMove: ProjectGroupViewProps['onMove']): void {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key === 'ArrowUp' && prev !== null) onMove(key, prev);
  else if (e.key === 'ArrowDown' && next !== null) onMove(key, afterNext);
  else return;
  e.preventDefault();
  const header = e.currentTarget;
  requestAnimationFrame(() => header.focus());
}

// Zona de 8 px tras la última carpeta: soltar aquí la deja la última.
export function ProjectEndDropZone({ onMove }: { readonly onMove: ProjectGroupViewProps['onMove'] }): React.JSX.Element {
  return (
    <div
      data-project-drop-end="true"
      className="h-[8px]"
      onDragOver={(e) => isProjectDrag(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!isProjectDrag(e)) return;
        e.preventDefault();
        onMove(e.dataTransfer.getData(PROJECT_DRAG_TYPE), null);
      }}
    />
  );
}

// Proyecto: cabecera con chevron, carpeta, nombre, resumen (ámbar con el nº que piden algo, anillo si trabaja)
// y nº de conversaciones; «＋» y «⋯» solo con el ratón encima o el foco dentro. Desplegado por defecto; el
// plegado que elige el usuario vive aquí y no se persiste.
export function ProjectGroupView(props: ProjectGroupViewProps): React.JSX.Element {
  const { group, renderRow, indicatorOf, descendantIndicatorsOf, unlimited, forceOpen, emptyHint } = props;
  const [override, setOverride] = useState<boolean | null>(null);
  const open = forceOpen || (override ?? true);
  const indicators = group.rows.flatMap((row) => [indicatorOf(row), ...descendantIndicatorsOf(row)]);
  const summary = projectSummary(indicators);
  const t = useT();
  // Destino de un arrastre: línea de 2 px arriba (no mueve el contenido). Con el filtro activo no se arrastra.
  const [dropTarget, setDropTarget] = useState(false);
  const dropLine = dropTarget ? ' before:pointer-events-none before:absolute before:inset-x-0 before:top-[-1px] before:h-[2px] before:bg-mg-primary' : '';
  return (
    <section
      data-sidebar-group="project"
      {...(group.projectId === null ? {} : { 'data-chat-project': group.projectId })}
      className={`relative flex flex-col gap-px${dropLine}`}
      onDragOver={(e) => {
        if (!isProjectDrag(e)) return;
        e.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(false);
      }}
      onDrop={(e) => {
        setDropTarget(false);
        if (!isProjectDrag(e)) return;
        e.preventDefault();
        props.onMove(e.dataTransfer.getData(PROJECT_DRAG_TYPE), group.key);
      }}
    >
      <div
        draggable={!forceOpen}
        onDragStart={(e) => {
          e.dataTransfer.setData(PROJECT_DRAG_TYPE, group.key);
          e.dataTransfer.effectAllowed = 'move';
        }}
        className="group/proj flex h-[28px] items-center gap-[2px] rounded-[6px] pr-[4px] hover:bg-mg-hover focus-within:bg-mg-hover"
      >
        <button
          data-project-key={group.key}
          aria-expanded={open}
          data-tip={t('sidebar.project.reorderHint')}
          onKeyDown={(e) => moveByKey(e, group.key, props.neighbors, props.onMove)}
          onClick={() => setOverride(!open)}
          className="flex h-full min-w-0 flex-1 items-center gap-[6px] p-[0_6px] text-left font-semibold text-mg-body"
        >
          <span aria-hidden="true" className="text-mg-icon"><RotatingChevron open={open} size={12} /></span>
          <Icon name="folder" size={12} />
          <span className="truncate" title={group.name}>{group.name}</span>
        </button>
        <span className="flex flex-none items-center gap-[6px] text-[10.5px] font-normal text-mg-muted">
          {summary.attention > 0 && (
            <span data-project-attention={summary.attention} className="rounded-full border border-mg-warn-border bg-mg-warn-bg px-[6px] text-[10px] font-bold text-mg-warn-text">{summary.attention}</span>
          )}
          {summary.working && <span data-project-working="true" aria-hidden="true" className="mg-pulse h-[9px] w-[9px] rounded-full border-[1.5px] border-mg-sec" />}
          <span data-project-count={indicators.length}>{indicators.length}</span>
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
