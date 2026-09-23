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
