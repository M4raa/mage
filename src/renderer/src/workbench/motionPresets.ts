import type { Transition, Variants } from 'motion/react';

// Valores compartidos por TODO lo que entra/sale con motion (modales, popovers, menus): un solo sitio
// para los numeros (Gate 2 de pro-designer, registro "admin/data-dense" — fade/slide 120-200ms, sin
// bounce) evita que cada dialogo tenga su propia duracion "a ojo". La transicion vive DENTRO de cada
// variante (mas rapida al salir que al entrar, tabla de decisions.md) para que baste con
// `variants={...} initial="initial" animate="animate" exit="exit"` en el componente.

// Modales grandes (AddAccountDialog, HandoffModal, NewTabDialog): velo + panel.
export const MODAL_SCRIM_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

export const MODAL_PANEL_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.12, ease: 'easeIn' } },
};

// Popovers/menus contextuales (Dropdown, ConversationContextMenu, PanelMoveMenu, AddPanelMenu): mas
// pequenos y rapidos que un modal, sin velo opaco.
export const POPOVER_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.97, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.15, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.98, y: -2, transition: { duration: 0.12, ease: 'easeIn' } },
};

// Los selectores del prompt bajando a su fila cuando el texto salta de linea (P-026 3.1): `layout` de
// motion (FLIP), mismo registro. Con movimiento reducido, `MotionConfig reducedMotion="user"` lo vuelve
// un salto instantaneo.
export const COMPOSER_LAYOUT_TRANSITION: Transition = { duration: 0.18, ease: 'easeOut' };

// Indicador compartido de pestaña activa (TabBar, layoutId + FLIP): mismo registro 120-200ms.
export const TAB_INDICATOR_TRANSITION: Transition = { duration: 0.2, ease: 'easeOut' };

// Muestras de color del menu contextual de pestañas: realimentacion de hover, mas corta todavia
// (Type "feedback" de decisions.md — no debe competir con la entrada del propio menu).
export const TAB_COLOR_SWATCH_TRANSITION: Transition = { duration: 0.12, ease: 'easeOut' };

// Contenido de una zona de dock (ZonePane): fundido al abrir la zona o al cambiar de panel activo.
export const PANEL_CONTENT_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.15, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: 'easeIn' } },
};

// Despliegue EN SU SITIO (FilesPanel: la previsualizacion del fichero elegido, 2026-09-21). A
// diferencia de un popover, esto no flota encima de nada: EMPUJA a lo que tiene debajo, asi que hay
// que animar la ALTURA ademas de la opacidad — sin eso, el resto de la lista salta de golpe y el
// movimiento no explica de donde sale el contenido. `height: 'auto'` lo mide motion solo.
//
// Quien lo use tiene que llevar `overflow: hidden`, o el contenido asoma fuera de la caja mientras
// esta encogida. Mismo registro que el resto (120-200 ms, sin bounce).
export const DISCLOSURE_VARIANTS: Variants = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1, transition: { duration: 0.18, ease: 'easeOut' } },
  exit: { height: 0, opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

// Toasts de notificacion (abajo a la derecha): entran desde su borde, sin bounce. Con movimiento
// reducido `MotionConfig reducedMotion="user"` quita el desplazamiento y deja el fundido.
export const TOAST_VARIANTS: Variants = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.18, ease: 'easeOut' } },
  exit: { opacity: 0, x: 16, transition: { duration: 0.12, ease: 'easeIn' } },
};
