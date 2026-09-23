// Genera los SVG de marca (resources/brand/*.svg) a partir del arte de origen que dibuja el usuario.
//
// ORIGEN (cambiado el 2026-09-22): `design/my-mage-icon.png`, obra propia del usuario. Sustituye a
// `design/new_mage_icon.png`, que era el mago entero y del que solo se usaba el sombrero recortado a
// la fuerza. El motivo NO es estetico: es de procedencia (B.5 de la revision de licencias de terceros) — la marca de un
// proyecto que se publica en abierto tiene que ser de quien lo publica.
//
// El arte nuevo trae ALFA DE VERDAD: 3.738.970 pixeles a alpha=0 y RGB negro en las 4.194.304
// posiciones (medido). Asi que la figura NO se separa por color: se separa por ALFA. Eso borro de este
// script, por innecesarias, tres cosas que el arte viejo obligaba a tener: el relleno desde el borde
// que quitaba el damero horneado, la capa de "papel" (cara y barba del mago) y la morfologia que
// recortaba el sombrero (ventana medida + componente conexa + apertura + cierre horizontal).
//
// Los huecos del dibujo -la estrella y los pliegues- son transparentes como el fondo, y el marching
// squares los devuelve como bucles de sentido contrario: `fill-rule="evenodd"` los cala solo.
//
// Vectorizado por marching squares sobre ARISTAS de celda + Ramer-Douglas-Peucker. El arte es
// poligonal, asi que los tramos rectos colapsan a un segmento: el resultado es fiel, no una
// aproximacion suave.
//
// Ejecutar: `pnpm brand` (y despues `pnpm icons`, que rasteriza estos SVG a PNG/ICO).
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'design', 'my-mage-icon.png');
const brandDir = join(root, 'resources', 'brand');

// Paleta de marca: BLANCO SOBRE NEGRO y nada mas (decision del usuario, 2026-09-18, repetida). El
// ambar y el crema que habia antes hacian un icono de TRES colores; la marca es de dos.
const GROUND = '#141414';  // disco del icono: negro GRISACEO (peticion del usuario, 2026-09-18)
const FIGURE = '#ffffff';

// Alfa a partir del cual un pixel es figura. El borde antialias son 6.441 pixeles (0,15 %): el umbral
// a medio camino los reparte sin escalones visibles a ningun tamano de icono.
const ALPHA_MIN = 128;
const LIGHT_MIN = 170; // por encima = claro (damero o papel del dibujo)

// --- PNG: decodificacion minima (RGBA8, sin entrelazar) ------------------------------------------

function decodePng(path) {
  const b = readFileSync(path);
  let off = 8;
  let head = null;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString('latin1');
    const body = b.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') head = { w: body.readUInt32BE(0), h: body.readUInt32BE(4), depth: body[8], color: body[9] };
    if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  if (head === null || head.depth !== 8 || head.color !== 6) {
    throw new Error(`Solo se admite PNG RGBA de 8 bits sin entrelazar; leido: ${JSON.stringify(head)}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const { w, h } = head;
  const stride = w * 4;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride);
    p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const up = prev[x];
      const ul = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(up - ul);
        const pb = Math.abs(a - ul);
        const pc = Math.abs(a + up - 2 * ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      } else if (filter !== 0) throw new Error(`Filtro PNG desconocido: ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}
// --- Separacion de la figura ---------------------------------------------------------------------

const { w, h, data } = decodePng(SOURCE);
const ink = new Uint8Array(w * h);
for (let p = 0; p < w * h; p++) ink[p] = data[p * 4 + 3] >= ALPHA_MIN ? 1 : 0;
if (ink.every((v) => v === 0)) throw new Error(`El arte de origen no tiene ningun pixel con alfa >= ${ALPHA_MIN}: ${SOURCE}`);

// --- Vectorizado ---------------------------------------------------------------------------------

// Contornos de una mascara binaria. Cada celda de dentro aporta el lado que da a fuera, orientado
// siempre igual, de modo que los exteriores salen en un sentido y los agujeros en el contrario: es lo
// que `fill-rule="evenodd"` necesita para que la cara y la barba queden CALADAS y no tapadas.
function traceMask(mask) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const edges = new Map();
  const add = (x1, y1, x2, y2) => {
    const k = `${x1},${y1}`;
    const list = edges.get(k);
    if (list === undefined) edges.set(k, [[x2, y2]]);
    else list.push([x2, y2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 0) continue;
      if (at(x, y - 1) === 0) add(x, y, x + 1, y);
      if (at(x + 1, y) === 0) add(x + 1, y, x + 1, y + 1);
      if (at(x, y + 1) === 0) add(x + 1, y + 1, x, y + 1);
      if (at(x - 1, y) === 0) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const [start] of edges) {
    while ((edges.get(start)?.length ?? 0) > 0) {
      const loop = [];
      let key = start;
      let prev = null;
      for (;;) {
        const list = edges.get(key);
        if (list === undefined || list.length === 0) break;
        // Punto de silla: salen DOS aristas. Se elige siempre el mismo sentido de giro. Cualquier
        // eleccion consistente cierra bucles validos y cubre la misma area; una inconsistente deja
        // bucles abiertos.
        let idx = 0;
        const [cx, cy] = key.split(',').map(Number);
        if (list.length > 1 && prev !== null) {
          const din = [cx - prev[0], cy - prev[1]];
          const found = list.findIndex(([nx, ny]) => din[0] * (ny - cy) - din[1] * (nx - cx) > 0);
          if (found >= 0) idx = found;
        }
        const [nx, ny] = list.splice(idx, 1)[0];
        loop.push([cx, cy]);
        prev = [cx, cy];
        key = `${nx},${ny}`;
        if (key === start) break;
      }
      if (loop.length > 3) loops.push(loop);
    }
  }
  return loops;
}

function simplify(points, eps) {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function ringArea(points) {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// `eps` en pixeles del original: cuanto se puede desviar la recta simplificada. `minArea` descarta
// contornos por debajo de ese area — es lo que quita el ruido de antialias y, subiendolo, lo que
// produce las versiones SIMPLIFICADAS para 16 px.
function pathOf(mask, eps, minArea) {
  const loops = traceMask(mask)
    .map((loop) => simplify(loop, eps))
    .filter((loop) => loop.length > 2 && ringArea(loop) >= minArea);
  const d = loops.map((loop) => `M${loop.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`).join('');
  return { d, loops: loops.length, points: loops.reduce((n, l) => n + l.length, 0) };
}

const round = (n) => Math.round(n * 100) / 100;

// Caja que ocupa de verdad la tinta. El lienzo de origen trae mucho aire, y encajar por el lienzo
// dejaria el mago diminuto dentro de cada icono.
function bboxOf(d) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// Transformada que mete `box` centrada dentro de un cuadrado de lado `side` con `pad` de margen.
function fitTransform(box, side, pad) {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const scale = (side - pad * 2) / Math.max(bw, bh);
  const tx = pad + (side - pad * 2 - bw * scale) / 2 - box.x0 * scale;
  const ty = pad + (side - pad * 2 - bh * scale) / 2 - box.y0 * scale;
  return `translate(${round(tx)} ${round(ty)}) scale(${round(scale * 10000) / 10000})`;
}
// --- Emision -------------------------------------------------------------------------------------

// Sonda: `MAGE_LOOPS=1` vuelca el area de cada contorno del arte, de mayor a menor. Es con lo que se
// elige `minArea` de la version simplificada, en vez de adivinarlo.
if (process.env.MAGE_LOOPS === '1') {
  for (const loop of traceMask(ink).sort((a, b) => ringArea(b) - ringArea(a))) {
    console.log(`area=${Math.round(ringArea(loop))} puntos=${loop.length}`);
  }
  process.exit(0);
}

// Detallada: el dibujo entero, con la estrella y los pliegues calados.
const full = pathOf(ink, 1.2, 12);
// Simplificada para 16-32 px: rectas mas sueltas y fuera los calados que a ese tamano no se leen como
// dibujo, sino como suciedad en el contorno. `minArea` esta MEDIDO con `MAGE_LOOPS=1`.
const SMALL_MIN_AREA = Number(process.env.MAGE_SMALL_AREA ?? 3000);
const small = pathOf(ink, 6, SMALL_MIN_AREA);

const box = bboxOf(full.d);
const smallBox = bboxOf(small.d);

console.log(`detallada: ${full.loops} contornos / ${full.points} puntos`);
console.log(`simplificada: ${small.loops} contornos / ${small.points} puntos`);

const svg = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${body}\n</svg>\n`;

// Monocromo: un solo camino con los huecos CALADOS (fill-rule evenodd), asi el mismo dibujo vale sobre
// cualquier fondo.
const mono = (art, transform, fill) =>
  `  <path transform="${transform}" fill="${fill}" fill-rule="evenodd" d="${art.d}"/>`;

const files = {
  // Icono de aplicacion: disco gris oscuro + el sombrero en blanco (las esquinas transparentes las
  // espera electron-builder).
  'icon-app.svg': svg('0 0 1024 1024', `  <circle cx="512" cy="512" r="512" fill="${GROUND}"/>\n${mono(full, fitTransform(box, 1024, 170), FIGURE)}`),
  // Los tamanos pequenos del .ico (16-48): mismo disco, trazo simplificado y un pelo mas grande.
  'icon-small.svg': svg('0 0 1024 1024', `  <circle cx="512" cy="512" r="512" fill="${GROUND}"/>\n${mono(small, fitTransform(smallBox, 1024, 150), FIGURE)}`),
  // Simbolo de la UI: monocromo, hereda el color del contenedor.
  'symbol.svg': svg('0 0 80 80', mono(full, fitTransform(box, 80, 2), 'currentColor')),
  'tray.svg': svg('0 0 16 16', `  <!-- Bandeja @1x (16px). -->\n${mono(small, fitTransform(smallBox, 16, 0.4), '#ffffff')}`),
  'tray@2x.svg': svg('0 0 32 32', `  <!-- Bandeja @2x (32px). -->\n${mono(small, fitTransform(smallBox, 32, 0.8), '#ffffff')}`),
  // Plantilla de macOS: negro puro; el sistema la recolorea segun la barra de menus.
  'tray-template.svg': svg('0 0 16 16', `  <!-- Plantilla macOS @1x: negro, lo recolorea el sistema. -->\n${mono(small, fitTransform(smallBox, 16, 0.4), '#000000')}`),
  'tray-template@2x.svg': svg('0 0 32 32', `  <!-- Plantilla macOS @2x. -->\n${mono(small, fitTransform(smallBox, 32, 0.8), '#000000')}`),
  // Lockup: simbolo + palabra. El wordmark se queda como texto del sistema: pasarlo a contornos
  // exigiria empotrar una fuente, y no es lo que se pedia.
  'lockup.svg': svg(
    '0 0 172 72',
    `${mono(full, fitTransform(box, 72, 6), 'currentColor')}\n` +
      `  <text x="80" y="47" font-family="-apple-system, 'Segoe UI', system-ui, Helvetica, Arial, sans-serif" font-size="32" font-weight="600" letter-spacing="-0.64" fill="currentColor">Mage</text>`,
  ),
};

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(brandDir, name), content);
  console.log(`✓ ${name} (${content.length} bytes)`);
}

// Geometria para la UI (src/renderer/src/workbench/brandMark.ts). Se GENERA aqui, no se copia a mano:
// tenerla escrita en dos sitios ya costo una vez que el dibujo y su fuente se fueran cada uno por su
// lado. Va la version simplificada: la marca de la cabecera se pinta a ~20 px.
writeFileSync(
  join(root, 'src', 'renderer', 'src', 'workbench', 'brandMark.ts'),
  `// Geometria de la marca de Mage. GENERADA por \`pnpm brand\` a partir del arte de origen
// (design/my-mage-icon.png). NO se edita a mano: si cambia el icono, se vuelve a generar.
//
// Es el mismo dibujo que el icono de la aplicacion, para que la esquina superior izquierda y el icono
// de la barra de tareas sean uno solo. Un unico camino con los huecos calados (evenodd), asi que vale
// sobre cualquier superficie y hereda el color del contenedor.
export const MARK_VIEWBOX = '0 0 32 32';

export const MARK_TRANSFORM = '${fitTransform(smallBox, 32, 0.8)}';

export const MARK_PATH =
  '${small.d}';

// Cintura de la chispa de cuatro puntas que dibuja la constelacion del chat vacio. MEDIDA sobre el
// arte ANTERIOR (el mago entero): el vertice interior caia a 22 px del centro en la diagonal, con un
// radio de 38,5 px -> 22·cos45°/38,5 = 0,404. PENDIENTE de re-medir sobre el arte nuevo, donde la
// estrella es una concavidad del sombrero y no una chispa suelta: hasta entonces el valor se conserva
// porque es el que hay medido, no porque se haya comprobado contra este dibujo.
export const SPARKLE_WAIST_RATIO = 0.404;
`,
);
console.log('✓ src/renderer/src/workbench/brandMark.ts');
