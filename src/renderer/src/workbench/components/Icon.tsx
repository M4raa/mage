// Set de iconos propio de Mage. UN solo componente y UN solo mapa: `<Icon name="trash" />`.
//
// POR QUE EXISTE: el repo ya declara por escrito, en DOS sitios, que la iconografia es monocroma —
// `panels/panelRegistry.ts` ("un glifo, mismo estilo que ya usa la app, no emoji de color") y
// `toolClassify.ts` ("MONOCROMO a proposito: un emoji de color se sale de la paleta del tema y no
// conmuta con el")—. La regla estaba incumplida en ~70 sitios del renderer, todos con emoji de color.
// Un emoji no hereda `currentColor`, asi que con un tema claro importado quedan manchas de color que
// no pertenecen a ninguna paleta, y su metrica no es la de la fuente: descuadran la caja.
//
// DECISIONES, para no rediscutirlas:
// - SIN dependencia. ~30 iconos no justifican traerse una libreria entera, y ninguna trae los glifos
//   propios del proyecto. Los trazos son originales.
// - Rejilla de 16 y `stroke`, no `fill`: a 14 px el trazo se lee y el relleno se emborrona.
// - `currentColor` SIEMPRE. El color lo pone quien lo usa con una clase de texto, que es lo que hace
//   que el icono conmute con el tema. Ningun icono trae color propio.
// - `aria-hidden` por defecto. Un icono decorativo al lado de su texto NO debe anunciarse; el que va
//   solo dentro de un boton recibe `label` y pasa a ser `img` con nombre accesible.

export type IconName =
  // Navegacion de Configuracion
  | 'bell'
  | 'plug'
  | 'brain'
  | 'palette'
  | 'wand'
  | 'link'
  | 'hook'
  | 'shield'
  | 'keyboard'
  | 'broom'
  // Acciones
  | 'trash'
  | 'gear'
  | 'pencil'
  | 'clipboard'
  | 'save'
  | 'stop'
  | 'pin'
  | 'search'
  | 'plus'
  | 'close'
  | 'check'
  | 'chevron'
  | 'external'
  // Estado y avisos
  | 'warning'
  | 'error'
  | 'info'
  | 'question'
  | 'bug'
  | 'hourglass'
  | 'lock'
  // Objetos
  | 'folder'
  | 'branch'
  | 'folderOpen'
  | 'file'
  | 'note'
  | 'monitor'
  | 'diamond'
  | 'compress'
  | 'handshake'
  | 'sparkles';

// Trazos en una rejilla de 16x16. Se dibujan con `stroke`, sin relleno, salvo los puntos.
const PATHS: Readonly<Record<IconName, string>> = {
  bell: 'M8 2.2a3.6 3.6 0 0 0-3.6 3.6c0 3-1.1 4-1.1 4h9.4s-1.1-1-1.1-4A3.6 3.6 0 0 0 8 2.2ZM6.7 12a1.4 1.4 0 0 0 2.6 0',
  plug: 'M6 2.4v3.1M10 2.4v3.1M4.4 5.5h7.2v2a3.6 3.6 0 0 1-3.6 3.6A3.6 3.6 0 0 1 4.4 7.5ZM8 11.1v2.5',
  brain: 'M6.5 3a2 2 0 0 0-2 2 1.8 1.8 0 0 0-.9 3.2A2 2 0 0 0 5 11.4a1.8 1.8 0 0 0 3 .4V3.6A1.6 1.6 0 0 0 6.5 3ZM9.5 3a2 2 0 0 1 2 2 1.8 1.8 0 0 1 .9 3.2A2 2 0 0 1 11 11.4a1.8 1.8 0 0 1-3 .4',
  palette: 'M8 2.3a5.7 5.7 0 0 0 0 11.4c.9 0 1.3-.6 1.3-1.2 0-.8-.7-1-.7-1.7 0-.6.5-1 1.1-1h1.1a2.9 2.9 0 0 0 2.9-2.9C13.7 4.4 11.2 2.3 8 2.3ZM5.4 6.2h.01M8 4.8h.01M10.6 6.2h.01M5.2 9.2h.01',
  wand: 'M3.2 12.8 10 6M11.2 2.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5ZM5.4 3.1l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3ZM12.6 9.4l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3Z',
  link: 'M6.6 9.4a2.6 2.6 0 0 0 3.9.3l1.7-1.7a2.6 2.6 0 0 0-3.7-3.7l-1 1M9.4 6.6a2.6 2.6 0 0 0-3.9-.3L3.8 8a2.6 2.6 0 0 0 3.7 3.7l1-1',
  hook: 'M10.4 3v5.1a2.4 2.4 0 0 1-4.8 0V7M8 13.4v-1.9M5.6 3h1.8',
  shield: 'M8 2.4 3.6 4.1v3.5c0 2.7 1.8 5.2 4.4 6 2.6-.8 4.4-3.3 4.4-6V4.1Z',
  keyboard: 'M2.6 4.6h10.8v6.8H2.6ZM4.6 6.8h.01M6.7 6.8h.01M8.8 6.8h.01M10.9 6.8h.01M4.6 9.2h6.8',
  broom: 'M9.6 2.6 7 7.2M5.2 6.4l4.4-2.5 2.1 3.7-4.4 2.5ZM6.9 9.6 4.2 13.4M8.6 10.6l-1.7 2.8M5.2 8.6 3.4 11',
  trash: 'M3.5 4.6h9M6.4 4.6V3.2h3.2v1.4M4.7 4.6l.6 8.2h5.4l.6-8.2M6.8 6.8v3.8M9.2 6.8v3.8',
  gear: 'M8 6.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8ZM8 2.4l.5 1.4 1.5.4 1.1-1 1.3 1.3-1 1.1.4 1.5 1.4.5v1.8l-1.4.5-.4 1.5 1 1.1-1.3 1.3-1.1-1-1.5.4-.5 1.4H7.1l-.5-1.4-1.5-.4-1.1 1-1.3-1.3 1-1.1-.4-1.5-1.4-.5V7.1l1.4-.5.4-1.5-1-1.1 1.3-1.3 1.1 1 1.5-.4.5-1.4Z',
  pencil: 'M11.2 2.9 13.1 4.8 5.3 12.6 2.9 13.1 3.4 10.7ZM9.9 4.2l1.9 1.9',
  clipboard: 'M6 3.4H4.4v9.8h7.2V3.4H10M6 2.4h4v2H6ZM6 7.6h4M6 10h4',
  save: 'M3.2 3.2h7.4l2.2 2.2v7.4H3.2ZM5.4 3.2v3.4h4.6V3.2M5.4 12.8V9.4h5.2v3.4',
  stop: 'M5 5h6v6H5Z',
  pin: 'M6.2 2.6h3.6l-.5 4 2.3 2.1H4.4l2.3-2.1ZM8 8.7v4.7',
  search: 'M7.2 2.9a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6ZM10.4 10.4l2.7 2.7',
  plus: 'M8 3.6v8.8M3.6 8h8.8',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.4 8.4l3 3 6.2-6.8',
  chevron: 'M6.2 3.8 10.4 8l-4.2 4.2',
  external: 'M9.2 3.2h3.6v3.6M12.8 3.2 7.6 8.4M11.2 9.6v3.2H3.2V4.8h3.2',
  warning: 'M8 2.6 14 12.9H2ZM8 6.4v3M8 11.3h.01',
  error: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6ZM4.2 4.2l7.6 7.6',
  info: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6ZM8 7.3v4M8 5.1h.01',
  // Escarabajo: cuerpo, cabeza, antenas y tres patas por lado. Con trazo (sin relleno) como el resto
  // del set, para que a 16 px se lea que es un bicho y no una mancha.
  bug: 'M8 4.4a3.4 3.4 0 0 0-3.4 3.4v1.5a3.4 3.4 0 0 0 6.8 0V7.8A3.4 3.4 0 0 0 8 4.4ZM6.5 4.9a1.9 1.9 0 0 1 3 0M6.5 2.6l.9 1.3M9.5 2.6l-.9 1.3M8 4.4v6.7M4.6 6.7 2.7 5.6M4.6 8.6H2.5M4.6 10.5l-1.9 1.1M11.4 6.7l1.9-1.1M11.4 8.6h2.1M11.4 10.5l1.9 1.1',
  question: 'M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6ZM6.4 6.3a1.7 1.7 0 0 1 3.3.6c0 1.1-1.7 1.4-1.7 2.5M8 11.4h.01',
  hourglass: 'M4.4 2.8h7.2M4.4 13.2h7.2M4.9 2.8v2.1L8 8l3.1-3.1V2.8M4.9 13.2v-2.1L8 8l3.1 3.1v2.1',
  lock: 'M4.4 7.2h7.2v6H4.4ZM6 7.2V5.4a2 2 0 0 1 4 0v1.8M8 9.5v1.6',
  folder: 'M2.6 4.2h4l1.3 1.6h5.5v6.8H2.6Z',
  // Rama de git (P-026 3.5): tronco, un nodo en cada punta y la rama que sale hacia la derecha.
  branch: 'M5 4.9v6.2M11 6.9c0 2.4-6 1.8-6 4.2M5 2.4a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 1 1 0-2.5ZM5 11.1a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 1 1 0-2.5ZM11 4.4a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 1 1 0-2.5Z',
  folderOpen: 'M2.6 4.2h4l1.3 1.6h5.5v1.6M2.6 4.2v8.4h10.8l1.4-5.2H4Z',
  file: 'M4.2 2.6h5l3 3v7.8H4.2ZM9.2 2.6v3.2h3M6 8.6h4M6 10.8h4',
  note: 'M3.6 2.8h8.8v10.4H3.6ZM5.8 5.6h4.4M5.8 8h4.4M5.8 10.4h2.6',
  monitor: 'M2.6 3.4h10.8v6.8H2.6ZM6 12.6h4M8 10.2v2.4',
  // Conserva el significado del glifo propio del proyecto para "conversacion compartida" (el ◇ de
  // `chatInfoView`): no era un emoji de color, asi que se traduce en vez de sustituirse por otra cosa.
  diamond: 'M8 2.6 13.4 8 8 13.4 2.6 8Z',
  compress: 'M3 3l3 3M3 6h3V3M13 13l-3-3M13 10h-3v3M3 13l3-3M6 10v3H3M13 3l-3 3M10 3v3h3',
  handshake: 'M2.6 7.4 5 5h2.2L8 5.8 8.8 5H11l2.4 2.4M5 9.6l1.6 1.6M7 8.8l1.8 1.8M9 8.2l1.6 1.6M3.4 8.2l1.2 1.2M12.6 8.2l-1.2 1.2',
  sparkles: 'M6 2.6l.9 2.5 2.5.9-2.5.9L6 9.4l-.9-2.5-2.5-.9 2.5-.9ZM11.4 8.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z',
};

// Iconos cuyo trazo se cierra y pide relleno (el cuadrado de "detener" y poco mas).
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['stop']);

export interface IconProps {
  readonly name: IconName;
  // Lado de la caja en px. 14 es el tamaño de cuerpo de la app; 16 para nav y cabeceras.
  readonly size?: number;
  readonly className?: string;
  // Nombre accesible. SOLO cuando el icono va SOLO (sin texto al lado): entonces deja de ser
  // decorativo. Sin `label` el icono es `aria-hidden`, que es lo correcto junto a su etiqueta.
  readonly label?: string;
}

export function Icon({ name, size = 14, className = '', label }: IconProps): React.JSX.Element {
  const decorative = label === undefined;
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={`inline-block shrink-0 ${className}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// Exportado para el test: comprobar que ningun trazo se queda vacio y que no se cuela un `fill`
// codificado (que rompería el conmutado con el tema).
export const ICON_PATHS = PATHS;
