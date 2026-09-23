// Spike: QUE DECLARAN DE VERDAD los temas de Open VSX.
//
// POR QUE EXISTE: la auditoria de UI del 2026-09-16 propone tocar `vscodeTheme.ts` (componer el alfa,
// ampliar el TOKEN_MAP) apoyandose en como es el formato de VS Code, NO en temas reales. Este proyecto
// ya pago una vez el deducir en vez de medir. Esto baja los temas mas descargados del registro real y
// cuenta: claves con alfa, contribuciones por paquete, cobertura del TOKEN_MAP y presencia de licencia.
//
// Reutiliza a proposito el MISMO algoritmo de ZIP que `src/main/theme/vsixZip.ts` (central directory a
// mano, sin dependencias), asi que de paso mide si ese lector aguanta los .vsix reales.
//
// Uso: node spike/vsx-theme-spike.mjs [cuantos]
import { inflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const HOW_MANY = Number(process.argv[2] ?? 24);
const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

// --- Lector de ZIP, calcado de vsixZip.ts -------------------------------------------------------
function findEocd(zip) {
  const minStart = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= minStart; i -= 1) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('ZIP invalido: sin EOCD');
}

function readCentralDirectory(zip) {
  const eocd = findEocd(zip);
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== CDH_SIG) throw new Error(`CDH inesperada en ${offset}`);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateEntry(zip, entry) {
  const lho = entry.localHeaderOffset;
  if (zip.readUInt32LE(lho) !== LFH_SIG) throw new Error(`LFH inesperada para ${entry.name}`);
  const nameLen = zip.readUInt16LE(lho + 26);
  const extraLen = zip.readUInt16LE(lho + 28);
  const start = lho + 30 + nameLen + extraLen;
  const data = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`metodo ${entry.method}`);
}

// --- Los tokens que hoy busca vscodeTheme.ts ----------------------------------------------------
// Copiados del TOKEN_MAP real (primer candidato de cada cadena) mas los que la auditoria propone añadir.
const HOY = [
  'editor.background', 'activityBar.background', 'sideBar.background', 'editorWidget.background',
  'textCodeBlock.background', 'list.activeSelectionBackground', 'list.hoverBackground', 'panel.border',
  'input.border', 'editor.foreground', 'descriptionForeground', 'focusBorder', 'button.background',
  'progressBar.background', 'errorForeground', 'inputValidation.errorBorder',
];
const PROPUESTOS = [
  'editorWarning.foreground', 'diffEditor.insertedTextBackground', 'diffEditor.removedTextBackground',
  'gitDecoration.addedResourceForeground', 'gitDecoration.deletedResourceForeground',
  'editorHoverWidget.background', 'scrollbarSlider.background', 'editorIndentGuide.background1',
];

const ALFA = /^#[0-9a-fA-F]{8}$/;

// --- JSONC, calcado de vsixJson.ts --------------------------------------------------------------
// Los ficheros de tema de VS Code son JSONC. Un `JSON.parse` pelado revienta con 3 de los 12 temas mas
// descargados: esta funcion es lo que hace que la medicion valga.
function stripJsonComments(text) {
  let out = '', inString = false, inLine = false, inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (inLine) { if (ch === '\n') { inLine = false; out += ch; } continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i += 1; } continue; }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 1; } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i += 1; continue; }
    out += ch;
  }
  return out;
}

function parseJsonc(text) {
  return JSON.parse(stripJsonComments(text.replace(/^﻿/, '')).replace(/,(\s*[}\]])/g, '$1'));
}

async function main() {
  const search = `https://open-vsx.org/api/-/search?category=Themes&size=${HOW_MANY}&sortBy=downloadCount`;
  const found = await (await fetch(search, { headers: { 'User-Agent': 'mage-spike' } })).json();
  console.log(`# Spike Open VSX — ${found.extensions.length} temas mas descargados\n`);

  const stats = {
    paquetes: 0, fallos: 0, sinLicencia: 0,
    contribuciones: [], clavesTotales: [], conAlfa: [], alfaEnTokensQueUsamos: 0,
    coberturaHoy: [], ganaPropuestos: [],
  };

  for (const ext of found.extensions) {
    const id = `${ext.namespace}.${ext.name}`;
    try {
      const meta = await (await fetch(`https://open-vsx.org/api/${ext.namespace}/${ext.name}`)).json();
      const url = meta.files?.download;
      if (!url) throw new Error('sin download');
      const zip = Buffer.from(await (await fetch(url)).arrayBuffer());
      const entries = readCentralDirectory(zip);

      const pkgEntry = entries.find((e) => e.name === 'extension/package.json');
      const pkg = parseJsonc(inflateEntry(zip, pkgEntry).toString('utf8'));
      const temas = pkg.contributes?.themes ?? [];
      stats.contribuciones.push(temas.length);
      if (!meta.license) stats.sinLicencia += 1;

      // Solo el primer tema contribuido, que es lo que hace Mage hoy.
      const rel = String(temas[0]?.path ?? '').replace(/^\.\//, '');
      const themeEntry = entries.find((e) => e.name === `extension/${rel}`);
      if (!themeEntry) throw new Error(`no esta ${rel}`);
      const theme = parseJsonc(inflateEntry(zip, themeEntry).toString('utf8'));
      const colors = theme.colors ?? {};
      const claves = Object.keys(colors);

      const conAlfa = claves.filter((k) => ALFA.test(String(colors[k]).trim()));
      const alfaNuestros = HOY.filter((k) => colors[k] !== undefined && ALFA.test(String(colors[k]).trim()));
      const cobertura = HOY.filter((k) => colors[k] !== undefined).length;
      const gana = PROPUESTOS.filter((k) => colors[k] !== undefined).length;

      stats.paquetes += 1;
      stats.clavesTotales.push(claves.length);
      stats.conAlfa.push(conAlfa.length);
      stats.alfaEnTokensQueUsamos += alfaNuestros.length;
      stats.coberturaHoy.push(cobertura);
      stats.ganaPropuestos.push(gana);

      console.log(
        `${id.padEnd(38)} temas=${String(temas.length).padStart(2)} claves=${String(claves.length).padStart(3)} ` +
          `alfa=${String(conAlfa.length).padStart(3)} cobertura=${cobertura}/${HOY.length} ` +
          `propuestos=${gana}/${PROPUESTOS.length} lic=${meta.license ?? '-'}` +
          (alfaNuestros.length ? `\n    ALFA en claves que Mage SI usa: ${alfaNuestros.join(', ')}` : ''),
      );
    } catch (err) {
      stats.fallos += 1;
      console.log(`${id.padEnd(38)} ERROR: ${String(err.message).slice(0, 70)}`);
    }
  }

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const med = (a) => (a.length ? (sum(a) / a.length).toFixed(1) : '-');
  console.log(`
## Resumen
paquetes leidos ..................... ${stats.paquetes} (fallos: ${stats.fallos})
temas contribuidos por paquete ...... media ${med(stats.contribuciones)} · max ${Math.max(...stats.contribuciones, 0)} · con >1: ${stats.contribuciones.filter((n) => n > 1).length}
claves de color por tema ............ media ${med(stats.clavesTotales)} · min ${Math.min(...stats.clavesTotales, 0)} · max ${Math.max(...stats.clavesTotales, 0)}
claves CON ALFA por tema ............ media ${med(stats.conAlfa)} · temas con al menos una: ${stats.conAlfa.filter((n) => n > 0).length}/${stats.paquetes}
ALFA en claves que Mage SI mapea .... ${stats.alfaEnTokensQueUsamos} apariciones (esto es VSX-1)
cobertura del TOKEN_MAP de hoy ...... media ${med(stats.coberturaHoy)}/${HOY.length}
claves nuevas que ganarian .......... media ${med(stats.ganaPropuestos)}/${PROPUESTOS.length} (esto es VSX-2)
paquetes SIN licencia declarada ..... ${stats.sinLicencia}/${stats.paquetes} (esto es B.6 / VSX-9)
`);
  writeFileSync('.verify-out/vsx-spike.json', JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
