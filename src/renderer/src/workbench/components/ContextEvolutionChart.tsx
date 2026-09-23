import { useLayoutEffect, useRef, useState } from 'react';
import type { ContextSizePoint } from '../contextView';

// Grafico de linea (SVG inline, sin dependencia) de la evolucion del tamano de contexto turno a
// turno, con marca de evento en las compactaciones. Diseno segun la skill `dataviz` (paleta
// validada, marcas, capa de hover):
// - Serie unica -> SIN leyenda (el titulo del panel ya dice que se plotea).
// - Linea 2px, azul slot-1 (surface oscura); relleno de area ~10% como wash.
// - Compactacion = ANOTACION DE EVENTO (no una serie): linea de referencia + punto + icono/label
//   en color de ESTADO "serious", nunca color de serie -> identidad nunca por color solo.
// - Ejes/grid recesivos (hairline). Capa de hover con crosshair + tooltip (por defecto en lineas).

// Colores `dataviz` como variables CSS del tema (M3): conmutan claro/oscuro sin recolorear en JS. El
// SVG acepta var() en fill/stroke. Definidas en index.css (--mg-chart-*).
const SERIES = 'var(--mg-chart-1)'; // categorical slot 1 (blue)
const SERIES_FILL = 'var(--mg-chart-series-fill)'; // wash bajo la linea
const EVENT = 'var(--mg-chart-event)'; // status "serious" del evento de compactacion (icono+label, nunca solo color)
const GRID = 'var(--mg-chart-grid)';
const BASELINE = 'var(--mg-chart-baseline)';
const AXIS_TEXT = 'var(--mg-chart-axis)';
const SURFACE = 'var(--mg-chart-surface)';

const HEIGHT = 150;
const MARGIN = { top: 16, right: 8, bottom: 18, left: 8 } as const;
const FALLBACK_WIDTH = 260;
const DOT_R = 4;

interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly point: ContextSizePoint;
}

export function ContextEvolutionChart({ points }: { readonly points: readonly ContextSizePoint[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Mide el ancho real en pixeles (el inspector tiene ancho fijo pero puede cambiar): geometria en
  // pixeles = posicionamiento exacto del tooltip HTML sin distorsion por escalado de viewBox.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? FALLBACK_WIDTH;
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotW = Math.max(1, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baselineY = MARGIN.top + plotH;
  const maxContext = Math.max(1, ...points.map((p) => p.contextTokens));

  const geometry: readonly Geometry[] = points.map((point, i) => ({
    x: points.length === 1 ? MARGIN.left + plotW / 2 : MARGIN.left + (i / (points.length - 1)) * plotW,
    y: baselineY - (point.contextTokens / maxContext) * plotH,
    point,
  }));

  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  const linePath = geometry.map((g, i) => `${i === 0 ? 'M' : 'L'} ${g.x.toFixed(1)} ${g.y.toFixed(1)}`).join(' ');
  const areaPath =
    first !== undefined && last !== undefined ? `${linePath} L ${last.x.toFixed(1)} ${baselineY} L ${first.x.toFixed(1)} ${baselineY} Z` : '';
  const compactions = geometry.filter((g) => g.point.isCompaction);
  const hover = hoverIndex !== null ? (geometry[hoverIndex] ?? null) : null;

  const onMove = (event: React.MouseEvent<SVGRectElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    // Punto mas cercano en el eje X (nearest-index).
    let nearest = 0;
    let bestDist = Infinity;
    geometry.forEach((g, i) => {
      const dist = Math.abs(g.x - localX);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <svg width={width} height={HEIGHT} role="img" aria-label="Evolución del tamaño de contexto por turno">
        {/* Grid horizontal superior (max) + baseline (0): hairline recesivo, solido. */}
        <line x1={MARGIN.left} y1={MARGIN.top} x2={width - MARGIN.right} y2={MARGIN.top} stroke={GRID} strokeWidth={1} />
        <line x1={MARGIN.left} y1={baselineY} x2={width - MARGIN.right} y2={baselineY} stroke={BASELINE} strokeWidth={1} />

        {/* Etiquetas del eje Y (max arriba, 0 abajo): texto muted, tabular. */}
        <text x={MARGIN.left} y={MARGIN.top - 5} fill={AXIS_TEXT} fontSize={9} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCompact(maxContext)}
        </text>
        <text x={MARGIN.left} y={baselineY + 12} fill={AXIS_TEXT} fontSize={9}>
          0 tok · {points.length} turnos
        </text>

        {/* Anotaciones de compactacion: linea de referencia + icono, color de estado. */}
        {compactions.map((g) => (
          <g key={`c-${g.point.entryIndex}`}>
            <line x1={g.x} y1={MARGIN.top} x2={g.x} y2={baselineY} stroke={EVENT} strokeWidth={1} opacity={0.7} />
            <text x={g.x} y={MARGIN.top - 5} fill={EVENT} fontSize={9} textAnchor="middle">
              ⟲
            </text>
          </g>
        ))}

        {areaPath !== '' && <path d={areaPath} fill={SERIES_FILL} stroke="none" />}
        {geometry.length > 1 && <path d={linePath} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

        {/* Punto unico: si solo hay 1 turno, la linea no se ve -> marca el punto. */}
        {geometry.length === 1 && first !== undefined && (
          <circle cx={first.x} cy={first.y} r={DOT_R} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
        )}

        {/* Marcador de las compactaciones sobre la serie (dot con anillo de surface). */}
        {compactions.map((g) => (
          <circle key={`cd-${g.point.entryIndex}`} cx={g.x} cy={g.y} r={DOT_R} fill={EVENT} stroke={SURFACE} strokeWidth={2} />
        ))}

        {/* Capa de hover: crosshair + dot enfocado. */}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={hover.x} y1={MARGIN.top} x2={hover.x} y2={baselineY} stroke={AXIS_TEXT} strokeWidth={1} opacity={0.5} />
            <circle cx={hover.x} cy={hover.y} r={DOT_R} fill={hover.point.isCompaction ? EVENT : SERIES} stroke={SURFACE} strokeWidth={2} />
          </g>
        )}

        {/* Overlay transparente que captura el hover (hit target = todo el area de ploteo). */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIndex(null)}
        />
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-[6px] border border-mg-border-pop bg-mg-tooltip px-[8px] py-[5px] text-[10px] text-mg-tooltip-ink shadow-lg"
          style={{ left: clampTooltipLeft(hover.x, width), top: 2 }}
        >
          <div className="text-mg-ter">Turno #{hover.point.entryIndex}</div>
          <div>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{hover.point.contextTokens.toLocaleString('es')}</span> tok de contexto
          </div>
          {hover.point.isCompaction && <div style={{ color: EVENT }}>⟲ compactación</div>}
        </div>
      )}
    </div>
  );
}

// Mantiene el tooltip dentro del ancho del grafico (no se sale por la derecha).
function clampTooltipLeft(x: number, width: number): number {
  const TOOLTIP_W = 120;
  return Math.max(0, Math.min(x - TOOLTIP_W / 2, width - TOOLTIP_W));
}

// Formato compacto de tokens (12.9K / 1.2M). Enteros; nunca decimales para <1000.
function formatCompact(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${(n / 1_000_000).toFixed(1)}M tok`;
}
