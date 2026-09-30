// Rasteriza los SVG de marca (resources/brand/*.svg) a los assets que necesita la app:
//  - PNG del icono de app (1024 master para electron-builder, 256 fallback de ventana).
//  - `icon.ico` MULTI-TAMAÑO para Windows: tamaños pequeños (16–48) con el glifo SIMPLIFICADO y grueso
//    (icon-small.svg, legible a 16px) y grandes (64–256) con el icono completo (icon-app.svg).
//  - PNG de bandeja (16/32).
// Usa @resvg/resvg-js (SVG->PNG, binario preempaquetado) + png-to-ico (empaqueta el .ico).
// Ejecutar: `pnpm icons`. Re-ejecutar al cambiar cualquier SVG de resources/brand/.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const brandDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'brand');

// Rasteriza un SVG a un buffer PNG del ancho dado (fondo transparente si el SVG no lo pinta).
function renderPng(svgName, width) {
  const svg = readFileSync(join(brandDir, svgName), 'utf8');
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

function writePng(pngName, svgName, width) {
  writeFileSync(join(brandDir, pngName), renderPng(svgName, width));
  console.log(`✓ ${pngName} (${width}px)`);
}

writePng('icon-1024.png', 'icon-app.svg', 1024); // master para electron-builder (genera .icns/.png)
writePng('icon-256.png', 'icon-app.svg', 256); // fallback de ventana (macOS/Linux en dev)
writePng('tray-32.png', 'tray@2x.svg', 32); // bandeja Win/Linux @2x (200% DPI)
writePng('tray-16.png', 'tray.svg', 16); // bandeja Win/Linux @1x (16px nativo)
writePng('tray-template.png', 'tray-template.svg', 16); // bandeja macOS (template, negro) @1x
writePng('tray-template@2x.png', 'tray-template@2x.svg', 32); // bandeja macOS (template) @2x

// icon.ico multi-tamaño: pequeños con el glifo simplificado (nítido a 16px), grandes con el completo.
const icoPngs = [
  renderPng('icon-small.svg', 16),
  renderPng('icon-small.svg', 24),
  renderPng('icon-small.svg', 32),
  renderPng('icon-small.svg', 48),
  renderPng('icon-app.svg', 64),
  renderPng('icon-app.svg', 128),
  renderPng('icon-app.svg', 256),
];
writeFileSync(join(brandDir, 'icon.ico'), await pngToIco(icoPngs));
console.log('✓ icon.ico (16,24,32,48,64,128,256)');

// --- Instalador NSIS (grupo B de la 0.1.2) ---------------------------------------------------------
// NSIS solo admite BMP: la barra lateral de las paginas de bienvenida y final (164x314) y la cabecera
// del resto de paginas (150x57, a la derecha). electron-builder los recoge solos por su nombre en
// `resources/brand/` (buildResources); no entran en el asar (`files` solo mete .png e .ico). Se
// componen desde el simbolo PUBLICO (symbol.svg) con los colores del tema oscuro de la app
// (--color-mg-window y --color-mg-text de main.css): los mismos que `installer.nsh` da a MUI.
const INSTALLER_BG = '#141414';
const INSTALLER_FG = '#f0f0f0';
const INSTALLER_FONT = "'Segoe UI', system-ui, sans-serif";

// El <path> del simbolo, pintado con el color del texto (en el SVG va con currentColor).
const symbolPath = readFileSync(join(brandDir, 'symbol.svg'), 'utf8')
  .match(/<path[\s\S]*?\/>/)?.[0]
  ?.replace('currentColor', INSTALLER_FG);
if (symbolPath === undefined) throw new Error('symbol.svg no tiene el <path> del simbolo');

function symbolAt(x, y, size) {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 80 80">${symbolPath}</svg>`;
}

function wordmarkAt(x, y, fontSize, anchor) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${INSTALLER_FONT}" font-size="${fontSize}" font-weight="600" letter-spacing="-0.4" fill="${INSTALLER_FG}">Mage</text>`;
}

function installerSvg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${INSTALLER_BG}"/>${body}</svg>`;
}

// BMP de 24 bits sin compresion: filas de abajo arriba, en BGR y rellenas a multiplo de 4 bytes. El
// fondo del SVG es opaco, asi que el alfa de resvg se ignora.
function encodeBmp24({ width, height, pixels }) {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const header = 54;
  const out = Buffer.alloc(header + rowBytes * height);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(header, 10);
  out.writeUInt32LE(40, 14); // BITMAPINFOHEADER
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26); // planos
  out.writeUInt16LE(24, 28); // bits por pixel
  out.writeUInt32LE(rowBytes * height, 34);
  for (let y = 0; y < height; y += 1) {
    const rowStart = header + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = rowStart + x * 3;
      out[dst] = pixels[src + 2];
      out[dst + 1] = pixels[src + 1];
      out[dst + 2] = pixels[src];
    }
  }
  return out;
}

function writeBmp(bmpName, width, height, body) {
  const image = new Resvg(installerSvg(width, height, body), { font: { loadSystemFonts: true } }).render();
  if (image.width !== width || image.height !== height) {
    throw new Error(`${bmpName}: resvg dio ${image.width}x${image.height}, se esperaba ${width}x${height}`);
  }
  writeFileSync(join(brandDir, bmpName), encodeBmp24(image));
  console.log(`✓ ${bmpName} (${width}x${height}, 24 bits)`);
}

// Barra lateral: el simbolo grande y el nombre, algo por encima del centro (el texto de la pagina va
// a la derecha y abajo queda aire).
writeBmp('installerSidebar.bmp', 164, 314, `${symbolAt(42, 92, 80)}${wordmarkAt(82, 204, 28, 'middle')}`);
// Cabecera: simbolo y nombre pegados a la derecha, sobre el mismo fondo que la franja de MUI.
writeBmp('installerHeader.bmp', 150, 57, `${symbolAt(58, 12, 32)}${wordmarkAt(140, 36, 17, 'end')}`);
