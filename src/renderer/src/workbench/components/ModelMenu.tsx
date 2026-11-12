import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { POPOVER_VARIANTS } from '../motionPresets';
import { useLocalPopover } from '../localPopovers';
import { isArrowNavKey, nextIndexForArrow } from '../a11y/keyboardNav';
import { menuLabelOf, splitModelsByFamily } from '../modelMenu';
import type { ModelOption } from '../models';
import { effortStepLabel, type SliderStep } from '../stepSliderModel';
import { useT } from '../../i18n/uiLanguage';
import { Icon } from './Icon';

// Selector de modelo con el esfuerzo DENTRO (B1, como en Claude Desktop): un chip «Opus 5.5 Alto» que abre
// los modelos más nuevos de cada familia, y debajo, dos submenús: «Esfuerzo» y «Más modelos».

export interface ModelMenuEffort {
  readonly steps: readonly SliderStep[];
  readonly value: string;
  // Cuándo se aplica el cambio (siguiente turno, al reabrir…): el texto fijo que abre el submenú.
  readonly note: string;
  readonly onChange: (level: string) => void;
}

export interface ModelMenuProps {
  readonly models: readonly ModelOption[];
  readonly value: string;
  readonly onModel: (id: string) => void;
  // null = el proveedor o el modelo no tienen esfuerzo (sin fila «Esfuerzo»).
  readonly effort: ModelMenuEffort | null;
  // false = el proveedor no cambia de modelo en caliente (runtime propio): el chip se pinta, sin menú.
  readonly interactive: boolean;
  readonly tip?: string;
  readonly ariaLabel: string;
}

type SubMenuName = 'effort' | 'more';

const MENU_WIDTH_PX = 260;
const MENU_GAP_PX = 6;
const SUBMENU_GAP_PX = 2;
const VIEWPORT_MARGIN_PX = 8;
const TRIGGER_CLASS = 'shrink-0 self-center rounded-full border border-mg-border-ctrl bg-transparent px-[8px] py-[2px] text-[10.5px] text-mg-text outline-none transition-colors duration-90 ease-out';
const PANEL_CLASS = 'max-h-[70vh] overflow-y-auto rounded-[8px] border border-mg-border-pop bg-mg-panel py-[4px] mg-shadow-pop';
const ROW_CLASS = 'flex w-full items-center gap-[9px] px-[11px] py-[6px] text-left text-[11.5px] text-mg-body2 hover:bg-mg-hover';
const ROW_SELECTOR = '[role^="menuitem"]';

interface SubPlacement {
  readonly left: number;
  readonly top: number;
}

export function ModelMenu({ models, value, onModel, effort, interactive, tip, ariaLabel }: ModelMenuProps): React.JSX.Element {
  const label = menuLabelOf(models, value);
  const chipText = (
    <>
      <span data-model-label="true">{label}</span>
      {effort !== null && <span className="text-mg-muted"> {effortStepLabel(effort.value)}</span>}
    </>
  );
  if (!interactive) {
    return <span data-model-menu="true" data-tip={tip} className={`${TRIGGER_CLASS} cursor-default`}>{chipText}</span>;
  }
  return <ModelMenuPopover models={models} value={value} onModel={onModel} effort={effort} ariaLabel={ariaLabel} tip={tip} chipText={chipText} />;
}

function ModelMenuPopover({ models, value, onModel, effort, ariaLabel, tip, chipText }: Omit<ModelMenuProps, 'interactive'> & { readonly chipText: React.ReactNode }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<SubMenuName | null>(null);
  const [placement, setPlacement] = useState<SubPlacement | null>(null);
  useLocalPopover(open);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<SubMenuName, HTMLButtonElement | null>>({ effort: null, more: null });
  const focusSubOnOpen = useRef(false);
  const { main, more } = useMemo(() => splitModelsByFamily(models), [models]);

  const closeAll = (): void => {
    setOpen(false);
    setSub(null);
    triggerRef.current?.focus();
  };
  const closeSub = (): void => {
    const name = sub;
    setSub(null);
    if (name !== null) rowRefs.current[name]?.focus();
  };
  const openSub = (name: SubMenuName, focus: boolean): void => {
    focusSubOnOpen.current = focus;
    setSub(name);
  };
  const pickModel = (id: string): void => {
    if (id !== value) onModel(id);
    closeAll();
  };
  const pickEffort = (level: string): void => {
    if (effort !== null && level !== effort.value) effort.onChange(level);
    closeAll();
  };

  // Posición del submenú: a la derecha del menú con su borde inferior en el de su fila; a la izquierda si no
  // cabe; su borde superior nunca por encima del margen de la ventana. Se mide ya montado, antes de pintar.
  useLayoutEffect(() => {
    const row = sub === null ? null : rowRefs.current[sub];
    const menu = menuRef.current;
    const panel = subRef.current;
    if (row === null || menu === null || panel === null) {
      setPlacement(null);
      return;
    }
    const menuRect = menu.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rightSide = menuRect.right + SUBMENU_GAP_PX;
    const fitsRight = rightSide + MENU_WIDTH_PX <= window.innerWidth - VIEWPORT_MARGIN_PX;
    setPlacement({
      left: fitsRight ? rightSide : menuRect.left - SUBMENU_GAP_PX - MENU_WIDTH_PX,
      // offsetHeight, no getBoundingClientRect: el panel entra con una escala y el rect saldría un 3 % corto.
      top: Math.max(VIEWPORT_MARGIN_PX, rowRect.bottom - panel.offsetHeight),
    });
    if (focusSubOnOpen.current) {
      focusSubOnOpen.current = false;
      const rows = panel.querySelectorAll<HTMLElement>(ROW_SELECTOR);
      (panel.querySelector<HTMLElement>('[aria-checked="true"]') ?? rows[0])?.focus();
    }
  }, [sub]);

  // Al abrir, el foco va al modelo actual (o a la primera fila).
  useLayoutEffect(() => {
    if (!open) return;
    const current = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (current ?? menuRef.current?.querySelector<HTMLElement>(ROW_SELECTOR))?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, inSub: boolean): void => {
    if (e.key === 'Tab') return closeAll();
    if (e.key === 'Escape') {
      e.preventDefault();
      return inSub ? closeSub() : closeAll();
    }
    if (inSub && e.key === 'ArrowLeft') {
      e.preventDefault();
      return closeSub();
    }
    const target = e.target as HTMLElement;
    const submenuOfRow = target.getAttribute('data-submenu') as SubMenuName | null;
    if (!inSub && e.key === 'ArrowRight' && submenuOfRow !== null) {
      e.preventDefault();
      return openSub(submenuOfRow, true);
    }
    if (!isArrowNavKey(e.key) || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    e.preventDefault();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    rows[nextIndexForArrow(rows.length, Math.max(0, rows.indexOf(target)), e.key)]?.focus();
  };

  const triggerRect = open ? triggerRef.current?.getBoundingClientRect() : undefined;
  const menuStyle: React.CSSProperties =
    triggerRect === undefined
      ? {}
      : {
          position: 'fixed',
          bottom: window.innerHeight - triggerRect.top + MENU_GAP_PX,
          right: Math.max(VIEWPORT_MARGIN_PX, Math.min(window.innerWidth - triggerRect.right, window.innerWidth - VIEWPORT_MARGIN_PX - MENU_WIDTH_PX)),
          width: MENU_WIDTH_PX,
          zIndex: 9999,
        };
  const submenuStyle: React.CSSProperties = { position: 'fixed', width: MENU_WIDTH_PX, zIndex: 9999, ...(placement === null ? { left: 0, top: 0, visibility: 'hidden' } : placement) };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-model-menu="true"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-tip={tip}
        onClick={() => (open ? closeAll() : setOpen(true))}
        className={`${TRIGGER_CLASS} cursor-pointer hover:bg-mg-hover`}
      >
        {chipText}
      </button>
      {createPortal(
        // AnimatePresence VA DENTRO del portal (un createPortal no es un elemento válido para él; ver Dropdown).
        <AnimatePresence>
          {open && (
          <>
            <div className="fixed inset-0 z-[9998]" onClick={closeAll} />
            <motion.div variants={POPOVER_VARIANTS} initial="initial" animate="animate" exit="exit" ref={menuRef} role="menu" aria-label={ariaLabel} onKeyDown={(e) => onKeyDown(e, false)} style={menuStyle} className={PANEL_CLASS}>
              {main.map((model) => (
                <ModelRow key={model.id} model={model} checked={model.id === value} onPick={pickModel} onHover={() => setSub(null)} />
              ))}
              <div className="my-[4px] border-t border-mg-border-subtle" />
              {effort !== null && (
                <SubmenuRow
                  name="effort"
                  label={t('prompt.modelMenu.effort')}
                  detail={effortStepLabel(effort.value)}
                  expanded={sub === 'effort'}
                  rowRefs={rowRefs}
                  onOpen={openSub}
                />
              )}
              {more.length > 0 && <SubmenuRow name="more" label={t('prompt.modelMenu.more')} expanded={sub === 'more'} rowRefs={rowRefs} onOpen={openSub} />}
            </motion.div>
            <AnimatePresence>
            {sub !== null && (
              <motion.div variants={POPOVER_VARIANTS} initial="initial" animate="animate" exit="exit" ref={subRef} role="menu" aria-label={t(sub === 'effort' ? 'prompt.modelMenu.effort' : 'prompt.modelMenu.more')} data-model-submenu={sub} onKeyDown={(e) => onKeyDown(e, true)} style={submenuStyle} className={PANEL_CLASS}>
                {sub === 'effort' && effort !== null && (
                  <>
                    <div className="p-[8px_11px] text-[11px] text-mg-muted">{effort.note}</div>
                    {effort.steps.map((step) => (
                      <RadioRow key={step.value} label={step.label} checked={step.value === effort.value} onPick={() => pickEffort(step.value)} />
                    ))}
                  </>
                )}
                {sub === 'more' && more.map((model) => <ModelRow key={model.id} model={model} checked={model.id === value} onPick={pickModel} />)}
              </motion.div>
            )}
            </AnimatePresence>
          </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function RadioRow({ label, checked, onPick, onHover }: { readonly label: string; readonly checked: boolean; readonly onPick: () => void; readonly onHover?: () => void }): React.JSX.Element {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} tabIndex={-1} onClick={onPick} onMouseEnter={onHover} className={`${ROW_CLASS} justify-between`}>
      <span className="truncate">{label}</span>
      {checked && <Icon name="check" size={12} className="text-mg-primary" />}
    </button>
  );
}

function ModelRow({ model, checked, onPick, onHover }: { readonly model: ModelOption; readonly checked: boolean; readonly onPick: (id: string) => void; readonly onHover?: () => void }): React.JSX.Element {
  return <RadioRow label={model.label} checked={checked} onPick={() => onPick(model.id)} onHover={onHover} />;
}

interface SubmenuRowProps {
  readonly name: SubMenuName;
  readonly label: string;
  readonly detail?: string;
  readonly expanded: boolean;
  readonly rowRefs: React.MutableRefObject<Record<SubMenuName, HTMLButtonElement | null>>;
  readonly onOpen: (name: SubMenuName, focus: boolean) => void;
}

// Fila que abre un submenú: al pasar el ratón, al pulsarla o con Flecha derecha (lo gestiona el menú).
function SubmenuRow({ name, label, detail, expanded, rowRefs, onOpen }: SubmenuRowProps): React.JSX.Element {
  const marks = name === 'effort' ? { 'data-menu-effort': 'true' } : { 'data-menu-more': 'true' };
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-haspopup="menu"
      aria-expanded={expanded}
      data-submenu={name}
      {...marks}
      ref={(node) => {
        rowRefs.current[name] = node;
      }}
      onClick={() => onOpen(name, false)}
      onMouseEnter={() => onOpen(name, false)}
      className={`${ROW_CLASS} justify-between`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-[6px] text-mg-muted">
        {detail !== undefined && <span>{detail}</span>}
        <Icon name="chevron" size={11} />
      </span>
    </button>
  );
}
