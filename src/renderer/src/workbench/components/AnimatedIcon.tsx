import { useEffect } from 'react';
import { motion, useAnimate, useReducedMotion } from 'motion/react';
import { Icon, type IconName } from './Icon';
import { EASE_ENTER, MOTION_S } from '../motionPresets';

// Iconos con vida (Q-U4): `motion` sobre nuestros SVG. Solo `transform`; con movimiento reducido no se
// mueve nada (a diferencia de las señales de estado, que sí se ralentizan en CSS).
export type IconAnimation = 'swing' | 'pulse' | 'lift';

interface Keyframes {
  readonly values: Record<string, number[]>;
  readonly duration: number;
}

const SWING_S = 0.4;
const LIFT_S = 0.22;
const PULSE_S = 1.6;
const PULSE_PEAK = 1.12;
const LIFT_PX = -4;

const KEYFRAMES: Record<IconAnimation, Keyframes> = {
  swing: { values: { rotate: [0, -14, 10, -6, 0] }, duration: SWING_S },
  lift: { values: { y: [0, LIFT_PX, 0] }, duration: LIFT_S },
  pulse: { values: { scale: [1, PULSE_PEAK, 1] }, duration: PULSE_S },
};

interface AnimatedGlyphProps {
  readonly animation: IconAnimation | null;
  // Cada cambio relanza, una sola vez, `swing` y `lift`; el 0 inicial no anima (montar no es un evento).
  // `pulse` late mientras `animation === 'pulse'` y no mira el contador.
  readonly trigger?: number;
  readonly children: React.ReactNode;
}

// Envuelve cualquier glifo (un SVG de Icon o el ⏎ del botón de enviar) en un `motion.span`.
export function AnimatedGlyph({ animation, trigger = 0, children }: AnimatedGlyphProps): React.JSX.Element {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced === true || animation === null || scope.current === null) return;
    if (animation !== 'pulse' && trigger === 0) return;
    const { values, duration } = KEYFRAMES[animation];
    const controls = animate(scope.current, values, {
      duration,
      ease: 'easeInOut',
      ...(animation === 'pulse' ? { repeat: Infinity } : {}),
    });
    // Al dejar de latir (o desmontar) el icono vuelve a su sitio.
    return () => controls.cancel();
  }, [animation, trigger, reduced, animate, scope]);
  return (
    <span ref={scope} className="inline-flex">
      {children}
    </span>
  );
}

interface AnimatedIconProps extends AnimatedGlyphProps {
  readonly name: IconName;
  readonly size?: number;
}

export function AnimatedIcon({ name, size, animation, trigger }: Omit<AnimatedIconProps, 'children'>): React.JSX.Element {
  return (
    <AnimatedGlyph animation={animation} {...(trigger === undefined ? {} : { trigger })}>
      <Icon name={name} {...(size === undefined ? {} : { size })} />
    </AnimatedGlyph>
  );
}

// Chevron que gira de 0 a 90° según el estado (aria-expanded de su botón). `initial={false}`: al montar ya
// abierto no hay giro.
export function RotatingChevron({ open, size }: { readonly open: boolean; readonly size: number }): React.JSX.Element {
  return (
    <motion.span aria-hidden="true" className="inline-flex flex-none" initial={false} animate={{ rotate: open ? 90 : 0 }} transition={{ duration: MOTION_S.base, ease: EASE_ENTER }}>
      <Icon name="chevron" size={size} />
    </motion.span>
  );
}
