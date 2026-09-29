import { useLayoutEffect, useRef } from 'react';

// Compartido por el chat y el panel de Actividad (P-026 3.4): se movio de BlockChat tal cual.

// Margen (px) por debajo del cual se considera que el usuario esta "pegado" al final del chat: con
// scroll dentro de ese margen, los mensajes nuevos siguen bajando solos; si ha subido a leer, no.
const STICK_TO_BOTTOM_PX = 80;

// Mantiene el chat pegado al final cuando llega contenido nuevo, SALVO que el usuario haya subido a
// leer (entonces no se le mueve el scroll bajo los pies). useLayoutEffect: mide y ajusta antes del
// pintado, asi no se ve el salto. Devuelve la ref del contenedor scrollable.
// `resetKey`: al cambiar, se vuelve a pegar al fondo (salto instantaneo) aunque el usuario hubiera
// subido: volver a una pestana o enviar un mensaje aterriza siempre abajo (puntos 13 y 25).
export function useStickToBottom(deps: readonly unknown[], resetKey?: string): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly onScroll: () => void;
} {
  const ref = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const lastResetKey = useRef(resetKey);

  // Cada scroll manual actualiza si seguimos "pegados" al final. Va como PROP de React y no como
  // `addEventListener` dentro de un `useEffect([])`: al arrancar en frio, el chat vacio devuelve
  // `<EmptyConversation/>` antes de pintar el div, asi que el efecto salia por `ref.current === null` y
  // con deps vacias no volvia a correr JAMAS — `stuckRef` se quedaba en `true` de por vida y cada delta
  // devolvia al usuario al fondo aunque hubiera subido a leer.
  const onScroll = (): void => {
    const element = ref.current;
    if (element === null) return;
    stuckRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_TO_BOTTOM_PX;
  };

  useLayoutEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      stuckRef.current = true;
    }
    const element = ref.current;
    if (element === null || !stuckRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [...deps, resetKey]);

  return { ref, onScroll };
}
