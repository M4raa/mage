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

// Trazos en una rejilla de 16x16, dibujados con `stroke`, sin relleno. Suite unificada de 85 iconos
// generada con Claude Design el 2026-09-29 (P-028, punto 24): redibuja los 40 anteriores y añade los
// de paneles (`panel*`), herramientas (`tool*`) y utilidad. Fuente: notes/revision-011/icon-paths.ts.
const PATHS = {
  bell: 'M8 2.2a3.6 3.6 0 0 0-3.6 3.6c0 3-1.1 4-1.1 4h9.4s-1.1-1-1.1-4A3.6 3.6 0 0 0 8 2.2ZM6.7 12a1.4 1.4 0 0 0 2.6 0',
  plug: 'M6 2.4v3.1M10 2.4v3.1M4.4 5.5h7.2v2a3.6 3.6 0 0 1-3.6 3.6A3.6 3.6 0 0 1 4.4 7.5ZM8 11.1v2.5',
  brain: 'M8 3.2v9.6M8 3.2a2.2 2.2 0 0 0-3.9 1.2A2.2 2.2 0 0 0 3 8.2a2.2 2.2 0 0 0 1.3 3.2A2 2 0 0 0 8 12.8M8 3.2a2.2 2.2 0 0 1 3.9 1.2A2.2 2.2 0 0 1 13 8.2a2.2 2.2 0 0 1-1.3 3.2A2 2 0 0 1 8 12.8M5.2 9.4c1 0 1.6-.6 1.6-1.6M10.8 9.4c-1 0-1.6-.6-1.6-1.6',
  palette: 'M8 2.5a5.5 5.5 0 0 0 0 11c1 0 1.4-.6 1.4-1.3c0-.9-.7-1.2-.7-2s.6-1.3 1.4-1.3h1.2c1.4 0 2.2-1 2.2-2.3C13.5 4.5 11.1 2.5 8 2.5ZM5.2 8.2h.1M6.2 5.3h.1M9.3 4.9h.1',
  wand: 'M2.6 13.4 11.8 4.2M9.2 5.2l1.6 1.6M5 2v2.4M3.8 3.2h2.4M12.6 8.4v2.4M11.4 9.6h2.4',
  link: 'M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7',
  hook: 'M10.5 4.6v5.2a3.2 3.2 0 0 1-6.4 0V8.4l1.8 1.4M10.5 4.6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z',
  shield: 'M8 2.2 3 4v3.8c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4Z',
  keyboard: 'M2.8 4.2h10.4a1.2 1.2 0 0 1 1.2 1.2v5.2a1.2 1.2 0 0 1-1.2 1.2H2.8a1.2 1.2 0 0 1-1.2-1.2V5.4a1.2 1.2 0 0 1 1.2-1.2ZM4.4 6.8h.1M6.8 6.8h.1M9.2 6.8h.1M11.6 6.8h.1M5.4 9.4h5.2',
  broom: 'M13.4 2.6 8.7 7.3M7 5.6l3.4 3.4M7 5.6c-2 .6-3.8 1.8-4.8 3.8l4.4 4.4c2-1 3.2-2.8 3.8-4.8M7.6 8.4l-2.2 2.2',
  trash: 'M3.5 4.6h9M6.4 4.6V3.2h3.2v1.4M4.7 4.6l.6 8.2h5.4l.6-8.2M6.8 6.8v3.8M9.2 6.8v3.8',
  gear: 'M6.6 3.9L6.8 2.3 9.2 2.3 9.4 3.9A4.3 4.3 0 0 1 10.8 4.8L12.3 4.1 13.5 6.2 12.2 7.2A4.3 4.3 0 0 1 12.2 8.8L13.5 9.8 12.3 11.9 10.8 11.2A4.3 4.3 0 0 1 9.4 12.1L9.2 13.7 6.8 13.7 6.6 12.1A4.3 4.3 0 0 1 5.2 11.2L3.7 11.9 2.5 9.8 3.8 8.8A4.3 4.3 0 0 1 3.8 7.2L2.5 6.2 3.7 4.1 5.2 4.8A4.3 4.3 0 0 1 6.6 3.9ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  pencil: 'M10.6 2.9a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L6 12.5l-3.2.7.7-3.2ZM9.4 4.1l2.5 2.5',
  clipboard: 'M5.5 3.4H4.2a1 1 0 0 0-1 1v8.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V4.4a1 1 0 0 0-1-1h-1.3M6.2 2.2h3.6a.7.7 0 0 1 .7.7v1a.7.7 0 0 1-.7.7H6.2a.7.7 0 0 1-.7-.7v-1a.7.7 0 0 1 .7-.7Z',
  save: 'M3.2 2.8h7.6l2 2v8a.8.8 0 0 1-.8.8H3.2a.8.8 0 0 1-.8-.8V3.6a.8.8 0 0 1 .8-.8ZM5.2 2.8v2.8h4.6V2.8M4.8 13.6V9.6h6.4v4',
  stop: 'M4.6 3.6h6.8a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1Z',
  pin: 'M6 2.6h4M6.8 2.6v3.6L4.6 8.8h6.8L9.2 6.2V2.6M8 8.8v4.6',
  search: 'M7 2.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8ZM10.2 10.2l3.2 3.2',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.4l3.2 3.2L13 4.8',
  chevron: 'M6 3.5 10.5 8 6 12.5',
  external: 'M12.5 9v3.3a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V4.7a1.2 1.2 0 0 1 1.2-1.2H7M9.5 2.5h4v4M13.5 2.5 8 8',
  warning: 'M7.1 3a1 1 0 0 1 1.8 0l5 8.7a1 1 0 0 1-.9 1.5H3a1 1 0 0 1-.9-1.5ZM8 6.3v3.2M8 11.3h.1',
  error: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM6 6l4 4M10 6l-4 4',
  info: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 7.4v3.4M8 5.2h.1',
  question: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM6.4 6.4a1.7 1.7 0 1 1 2.4 1.5c-.5.2-.8.6-.8 1.1v.2M8 11h.1',
  bug: 'M5.2 6.4h5.6v3.2a2.8 2.8 0 0 1-5.6 0ZM6 6.4a2 2 0 0 1 4 0M8 6.4v6M5.2 8.4H3M10.8 8.4H13M5.6 11 3.6 12.4M10.4 11l2 1.4M6.8 4.8l-1-1.5M9.2 4.8l1-1.5',
  hourglass: 'M4 2.5h8M4 13.5h8M5 2.5c0 3 3 3.5 3 5.5s-3 2.5-3 5.5M11 2.5c0 3-3 3.5-3 5.5s3 2.5 3 5.5',
  lock: 'M4 7.2h8a.8.8 0 0 1 .8.8v4.8a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V8a.8.8 0 0 1 .8-.8ZM5.4 7.2V5.4a2.6 2.6 0 0 1 5.2 0v1.8M8 9.6v1.4',
  folder: 'M2.6 4.2h4l1.3 1.6h5.5v6.8H2.6Z',
  branch: 'M5 2.5a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM5 10.9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM11 3.9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM5 5.1v5.8M11 6.5c0 2.6-6 1.8-6 4.4',
  folderOpen: 'M2.6 12.6V4.2h4l1.3 1.6h4.3v1.8M2.6 12.6l1.8-5h9.4l-1.8 5Z',
  file: 'M4.2 2.4h5l2.8 2.8v7.4a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1ZM9.2 2.4v2.8H12',
  note: 'M3 3.4a.9.9 0 0 1 .9-.9h8.2a.9.9 0 0 1 .9.9v5.8l-3.8 3.9H3.9a.9.9 0 0 1-.9-.9ZM13 9.2h-3a.8.8 0 0 0-.8.8v3.1M5.4 5.6h5.2M5.4 7.8h3',
  monitor: 'M2.8 3h10.4a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8V3.8a.8.8 0 0 1 .8-.8ZM8 11v2.2M5.4 13.2h5.2',
  diamond: 'M4.8 3h6.4L14 6.4 8 13.4 2 6.4ZM2 6.4h12M6.6 3 5.6 6.4 8 13.4l2.4-7-1-3.4',
  compress: 'M8 2.2v4.3M5.8 4.3 8 6.5l2.2-2.2M8 13.8V9.5M5.8 11.7 8 9.5l2.2 2.2M3 8h10',
  handshake: 'M1.8 6.8 4 4.6h2.4L8 5.8l1.6-1.2H12l2.2 2.2M3.2 8l4.1 3.9a1 1 0 0 0 1.4 0L12.8 8M8 5.8 6.2 7.6a.9.9 0 0 0 1.3 1.3l1.3-1.3 2 2',
  sparkles: 'M6.5 3c.5 3 1.5 4 4.5 4.5-3 .5-4 1.5-4.5 4.5-.5-3-1.5-4-4.5-4.5 3-.5 4-1.5 4.5-4.5ZM12 2v3M10.5 3.5h3M12.4 11.6h.1',
  panelConversations: 'M3.4 2.6h6.2a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1H6l-2.6 2v-2a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1ZM12.6 5.4a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1v1.8l-2.4-1.8H7.6a1 1 0 0 1-1-1v-.8',
  panelUsage: 'M4.3 12.7a5.2 5.2 0 1 1 7.4 0M8 9l2.5-2.5',
  panelPermissions: 'M8 2.2 3 4v3.8c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4ZM8 5a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 8 5ZM8 7.6v3.2M8 9.6h1.2',
  panelContext: 'M3.4 4h9.2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM4.8 6.4v3.2M6.8 6.4v3.2M8.8 6.4v3.2',
  panelLogs: 'M2.8 4h.1M5.4 4h7.8M2.8 8h.1M5.4 8h7.8M2.8 12h.1M5.4 12h5.4',
  panelMemory: 'M5.4 4.4h5.2a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1V5.4a1 1 0 0 1 1-1ZM6.4 2.4v2M9.6 2.4v2M6.4 11.6v2M9.6 11.6v2M2.4 6.4h2M2.4 9.6h2M11.6 6.4h2M11.6 9.6h2',
  panelMcp: 'M8 2.1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM3.8 10.1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12.2 10.1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7 5.5 4.8 9.6M9 5.5l2.2 4.1M6 11.6h4',
  panelInstructions: 'M4.2 2.4h7.6a1 1 0 0 1 1 1v9.2a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1ZM5.6 5.2h4.8M5.6 7.6h4.8M5.6 10h2.8',
  panelCommands: 'M3 4.5 6.5 8 3 11.5M8.5 11.5H13',
  panelAgents: 'M3.4 6.2h5.6a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V7.2a1 1 0 0 1 1-1ZM5 9.4v.6M7.4 9.4v.6M5.4 6.2V4.4a1 1 0 0 1 1-1h6.2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H10',
  panelTools: 'M10.4 2.5A3.3 3.3 0 0 0 7.3 6.8L2.8 11.3a1.3 1.3 0 0 0 1.9 1.9l4.5-4.5a3.3 3.3 0 0 0 4.3-3.1L11.8 5 11 4.2Z',
  panelArtifacts: 'M8 2.2 13.2 5v6L8 13.8 2.8 11V5ZM2.8 5 8 7.8 13.2 5M8 7.8v6',
  panelFiles: 'M2.4 2.4h3.6V5H2.4ZM4.2 5v6.2a1 1 0 0 0 1 1h2M4.2 7.6h3M7.2 6.3h6.2v2.6H7.2ZM7.2 10.9h6.2v2.6H7.2Z',
  panelActivity: 'M2.6 3.6h10.8M2.6 7h6M2.4 11.4H5l1.4-2.4 2 4.2 1.4-3 .9 1.2H14',
  toolRead: 'M8 4.4C6.6 3.4 4.8 3 2.4 3.2v9c2.4-.2 4.2.2 5.6 1.2 1.4-1 3.2-1.4 5.6-1.2v-9C11.2 3 9.4 3.4 8 4.4ZM8 4.4v9',
  toolGlob: 'M7.2 11.6H2V3.6h3.3l1.1 1.3h4.4V7M10.6 7.8a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM12.3 11.9l1.7 1.7',
  toolGrep: 'M2.2 3.6h9.6M2.2 7h4.2M2.2 10.4h3.4M10 6.4a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM12 11.2l2 2',
  toolEdit: 'M2.2 4h5.4M2.2 7.2h3.4M2.2 10.4h1.6M11.5 3.2a1.2 1.2 0 0 1 1.7 1.7L8 10.1l-2.1.5.4-2.2Z',
  toolWrite: 'M4.2 2.4h5l2.8 2.8v7.4a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1ZM9.2 2.4v2.8H12M7.6 7.4v4M5.6 9.4h4',
  toolBash: 'M3.4 3.2h9.2a1.2 1.2 0 0 1 1.2 1.2v7.2a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V4.4a1.2 1.2 0 0 1 1.2-1.2ZM4.9 6.4l1.9 1.7-1.9 1.7M8.4 9.8h2.8',
  toolWebSearch: 'M6.6 11A4.4 4.4 0 1 1 11 6.6M2.2 6.6H11M6.6 2.2a1.9 4.4 0 0 0 0 8.8M6.6 2.2a1.9 4.4 0 0 1 0 8.8M10.8 8.8a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM12.2 12.2l1.8 1.8',
  toolWebFetch: 'M6.6 11A4.4 4.4 0 1 1 11 6.6M2.2 6.6H11M6.6 2.2a1.9 4.4 0 0 0 0 8.8M6.6 2.2a1.9 4.4 0 0 1 0 8.8M11.8 8.6v5M9.8 11.6l2 2 2-2',
  toolAgent: 'M4.2 5.4h7.6a1.2 1.2 0 0 1 1.2 1.2v5.2a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 11.8V6.6a1.2 1.2 0 0 1 1.2-1.2ZM8 5.4V4M8 2.3a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6ZM6 8.8v.8M10 8.8v.8',
  toolTodo: 'M2.4 4l1.2 1.2 2.1-2.3M7.6 4h5.8M2.4 8.2l1.2 1.2 2.1-2.3M7.6 8.2h5.8M3 12.4h2M7.6 12.4h5.8',
  toolQuestion: 'M3.4 2.8h9.2a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H7.2l-2.8 2.2v-2.2h-1a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1ZM6.7 5a1.4 1.4 0 1 1 1.9 1.3c-.4.2-.6.5-.6.9M8 9.1h.1',
  toolMcp: 'M8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2ZM8 1.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM3.6 10.1a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM12.4 10.1a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM8 4.1v2.3M9.3 8.9l2.2 1.6M6.7 8.9l-2.2 1.6',
  toolGeneric: 'M3.8 2.4h6l2.8 1.4v1.4H3.8a.8.8 0 0 1-.8-.8V3.2a.8.8 0 0 1 .8-.8ZM6.6 5.2v7.6a.9.9 0 0 0 1.8 0V5.2',
  copy: 'M6.4 5.4h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1ZM10.6 5.4V3.6a1 1 0 0 0-1-1H3.6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.8',
  paperclip: 'M11.6 7.6 7.4 11.8a2.6 2.6 0 0 1-3.7-3.7l5-5a1.7 1.7 0 0 1 2.4 2.4l-5 5a.8.8 0 0 1-1.1-1.1l4.2-4.2',
  clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3l2 1.4',
  refresh: 'M13 8a5 5 0 1 1-1.4-3.5M12 2.2v2.6H9.4',
  eye: 'M1.8 8c1.4-2.8 3.6-4.4 6.2-4.4s4.8 1.6 6.2 4.4c-1.4 2.8-3.6 4.4-6.2 4.4S3.2 10.8 1.8 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  eyeOff: 'M1.8 8c1.4-2.8 3.6-4.4 6.2-4.4s4.8 1.6 6.2 4.4c-1.4 2.8-3.6 4.4-6.2 4.4S3.2 10.8 1.8 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM2.8 2.8l10.4 10.4',
  dragHandle: 'M6 4h.1M10 4h.1M6 8h.1M10 8h.1M6 12h.1M10 12h.1',
  arrowUp: 'M8 13V3M3.8 7.2 8 3l4.2 4.2',
  arrowDown: 'M8 3v10M3.8 8.8 8 13l4.2-4.2',
  newWindow: 'M5.8 5h7a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4.8 7.6h9M2.2 10.6V3.2a1 1 0 0 1 1-1h7.6',
  queue: 'M3.4 6.4h9.2a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM4 4.2h8M5.6 2.2h4.8',
  play: 'M5 3.3v9.4a.6.6 0 0 0 .9.5l7.2-4.7a.6.6 0 0 0 0-1L5.9 2.8a.6.6 0 0 0-.9.5Z',
  import: 'M8 2.4v7.4M5 6.8l3 3 3-3M2.6 10.4v2a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-2',
  globe: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2.5 8h11M8 2.5a2.4 5.5 0 0 0 0 11M8 2.5a2.4 5.5 0 0 1 0 11',
  puzzle: 'M2.6 5.2h2.8a1.4 1.4 0 1 1 2.6 0h2.8V8a1.4 1.4 0 1 1 0 2.6v2.8H2.6Z',
  user: 'M8 2.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM3 13.4a5.5 5.5 0 0 1 10 0',
  ellipsis: 'M3.5 8h.1M8 8h.1M12.5 8h.1',
  splitView: 'M3.2 3h9.6a1.2 1.2 0 0 1 1.2 1.2v7.6a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.8V4.2A1.2 1.2 0 0 1 3.2 3ZM8 3v10',
} as const;

export type IconName = keyof typeof PATHS;

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
