import { MARK_PATH, MARK_TRANSFORM, MARK_VIEWBOX } from '../brandMark';

// Marca de Mage en la UI. La geometria vive en `brandMark.ts` y la genera `pnpm brand` a partir del
// arte de origen, asi que este componente no dibuja nada propio: solo decide tamano y accesibilidad.
//
// Monocromo via `currentColor` (hereda el color del contenedor), asi conmuta con el tema. Los calados
// del sombrero son agujeros de verdad (`fill-rule="evenodd"`), no relleno del color del fondo: por eso
// se ve bien sobre cualquier superficie.
//
// Sin `title` es DECORATIVA (aria-hidden). Con `title` pasa a ser CONTENIDO (`role="img"` +
// `aria-label`): es lo que necesita la cabecera, donde sustituye al texto "MAGE" y ese texto era el
// unico nombre accesible de la app en la ventana.
export function MageMark({ size = 22, title }: { readonly size?: number; readonly title?: string }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    >
      <path transform={MARK_TRANSFORM} fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
