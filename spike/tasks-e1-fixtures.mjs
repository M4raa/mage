// Fixtures y comprobadores de los tres recorridos de E1 (carril R, INFORME-046 §E1): documento con fuentes,
// investigación con síntesis y organizar archivos. Puro: solo `node:fs`/`node:path`/`node:crypto`; no lanza ningún CLI.
// `createRecorrido(n, root)` crea lo que el recorrido necesita en `root` y devuelve `{ goal, folders, documents, check }`.
// `check()` devuelve `{ ok, details }` y NUNCA lanza por un fichero ausente (eso es un fallo del recorrido, no del comprobador).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MIN_CITED_NOTES = 4;
const WORDS_PER_DOCUMENT = 240;
const FILLER = 'El texto continúa con detalles de contexto que no añaden ningún dato nuevo y solo sirven para que el documento tenga la longitud de una nota de trabajo normal.';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const wordCount = (text) => text.split(/\s+/).filter((word) => word.length > 0).length;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Hash de cada fichero (ruta relativa con `/`) de un árbol; sirve para saber después si algo cambió.
function snapshot(dir) {
  const hashes = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else hashes.set(path.relative(dir, full).split(path.sep).join('/'), sha256(fs.readFileSync(full)));
    }
  };
  walk(dir);
  return hashes;
}

// Detalles de lo que cambió respecto a un snapshot: ficheros modificados, borrados o nuevos. Vacío = sin tocar.
function changesSince(dir, before) {
  const details = [];
  const now = fs.existsSync(dir) ? snapshot(dir) : new Map();
  for (const [name, hash] of before) {
    if (!now.has(name)) details.push(`${path.basename(dir)}/${name}: borrado o movido`);
    else if (now.get(name) !== hash) details.push(`${path.basename(dir)}/${name}: modificado`);
  }
  for (const name of now.keys()) if (!before.has(name)) details.push(`${path.basename(dir)}/${name}: nuevo`);
  return details;
}

const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function result(details) {
  return { ok: details.length === 0, details: details.length === 0 ? ['sin incidencias'] : details };
}

// --- Recorrido 1: documento con fuentes --------------------------------------------------------------------------

function sourceText(title, facts) {
  const lines = [`# ${title}`, '', ...facts];
  let words = wordCount(lines.join(' '));
  while (words < WORDS_PER_DOCUMENT) {
    lines.push(FILLER);
    words += wordCount(FILLER);
  }
  return `${lines.join('\n')}\n`;
}

const RECORRIDO_1_SOURCES = {
  'a.md': sourceText('Informe de la estación meteorológica de Pico Alto', [
    'La estación de Pico Alto se inauguró en 1974 a 2.140 metros de altitud y registra la temperatura cada diez minutos.',
    'En 2023 la temperatura media anual fue de 3,8 grados y la mínima absoluta, de 21 grados bajo cero, el 14 de enero.',
    'La estación la mantiene un equipo de cuatro técnicos que suben en turnos de quince días.',
  ]),
  'b.md': sourceText('Memoria del observatorio de aves del Humedal Largo', [
    'El observatorio del Humedal Largo cuenta 112 especies distintas desde que empezó el censo, en 1991.',
    'La especie más abundante es la focha común, con 1.350 ejemplares en el censo de invierno de 2022.',
    'El censo lo hacen 38 voluntarios repartidos en seis puntos de observación y se publica cada marzo.',
  ]),
  'c.md': sourceText('Nota sobre el presupuesto del sendero del Alto Valle', [
    'El presupuesto aprobado para arreglar el sendero del Alto Valle es de 86.400 euros, repartidos en tres fases.',
    'La primera fase, de 31.200 euros, cambia los 4 puentes de madera por pasarelas metálicas antes de octubre.',
    'La obra la adjudicó la mancomunidad a una cooperativa local con un plazo de ejecución de nueve meses.',
  ]),
};

const RECORRIDO_1_SOURCES_TXT = 'Fuentes autorizadas: entrada/a.md, entrada/b.md y entrada/c.md. Usa solo esos tres ficheros.\n';

function createRecorrido1(root) {
  const input = path.join(root, 'entrada');
  for (const [name, text] of Object.entries(RECORRIDO_1_SOURCES)) write(path.join(input, name), text);
  write(path.join(input, 'SOURCES.txt'), RECORRIDO_1_SOURCES_TXT);
  const before = snapshot(input);
  const report = path.join(root, 'salida', 'informe.md');
  const check = () => {
    const details = changesSince(input, before);
    const text = readIfExists(report);
    if (text === null) return result([...details, 'salida/informe.md no existe']);
    if (!text.includes('## Fuentes')) details.push('salida/informe.md no tiene la sección "## Fuentes"');
    for (const name of Object.keys(RECORRIDO_1_SOURCES)) if (!text.includes(name)) details.push(`salida/informe.md no cita ${name}`);
    return result(details);
  };
  return {
    goal: 'Escribe salida/informe.md de una página que resuma los tres ficheros de entrada y termine con una sección "## Fuentes" que liste por su nombre cada fichero usado.',
    folders: [root],
    documents: [],
    check,
  };
}

// --- Recorrido 2: investigación con síntesis ---------------------------------------------------------------------

const RECORRIDO_2_NOTES = {
  'nota-1.md': 'La cooperativa Lumbre se fundó en 2009 en el valle del Sorbe como cooperativa de consumo de aceite y miel.',
  'nota-2.md': 'Según el registro de socios, la cooperativa Lumbre tiene 240 socios y reparte sus excedentes cada diciembre.',
  'nota-3.md': 'La cooperativa Lumbre vende su aceite en tres mercados semanales y a dos comedores escolares de la comarca.',
  'nota-4.md': 'Según la memoria anual, la cooperativa Lumbre tiene 310 socios y ha duplicado su producción desde 2019.',
  'nota-5.md': 'La cooperativa Lumbre estrenó en 2022 una almazara propia con una capacidad de 4.000 kilos diarios.',
};

function createRecorrido2(root) {
  const corpus = path.join(root, 'corpus');
  for (const [name, text] of Object.entries(RECORRIDO_2_NOTES)) write(path.join(corpus, name), `${text}\n`);
  const before = snapshot(corpus);
  const synthesis = path.join(root, 'salida', 'sintesis.md');
  const check = () => {
    const details = changesSince(corpus, before);
    const text = readIfExists(synthesis);
    if (text === null) return result([...details, 'salida/sintesis.md no existe']);
    const cited = Object.keys(RECORRIDO_2_NOTES).filter((name) => text.includes(name));
    if (cited.length < MIN_CITED_NOTES) details.push(`salida/sintesis.md cita ${cited.length} notas del corpus (mínimo ${MIN_CITED_NOTES})`);
    for (const name of ['nota-2.md', 'nota-4.md']) if (!text.includes(name)) details.push(`salida/sintesis.md no menciona ${name}`);
    return result(details);
  };
  return {
    goal: 'Responde en salida/sintesis.md: qué dicen las notas sobre la cooperativa Lumbre; si hay contradicciones, cítalas con el nombre de fichero.',
    folders: [root],
    documents: [],
    check,
  };
}

// --- Recorrido 3: organizar archivos -----------------------------------------------------------------------------

const TXT_NAMES = ['acta-junio.txt', 'lista compra.txt', 'ideas_proyecto.txt', 'recetas-abuela.txt'];
const JPG_NAMES = ['IMG_0001.jpg', 'vacaciones playa.jpg', 'perfil.jpg', 'escaneo-03.jpg'];
const PDF_NAMES = ['factura-2024-11.pdf', 'contrato alquiler.pdf', 'manual_horno.pdf', 'billete.pdf'];

function createRecorrido3(root) {
  const messy = path.join(root, 'desorden');
  const foreign = path.join(root, 'ajeno');
  const textOf = (name) => `Contenido de ${name}\n`;
  const originals = new Map(); // nombre -> sha256 al crear
  for (const name of TXT_NAMES) write(path.join(messy, name), textOf(name));
  for (const name of [...JPG_NAMES, ...PDF_NAMES]) write(path.join(messy, name), '');
  for (const name of [...TXT_NAMES, ...JPG_NAMES, ...PDF_NAMES]) originals.set(name, sha256(fs.readFileSync(path.join(messy, name))));
  write(path.join(foreign, 'no-tocar.txt'), 'Este fichero no pertenece a la tarea.\n');
  const foreignBefore = snapshot(foreign);
  const check = () => {
    const details = changesSince(foreign, foreignBefore);
    const now = fs.existsSync(messy) ? snapshot(messy) : new Map();
    for (const [name, hash] of originals) {
      const placed = [...now].filter(([relative]) => path.posix.basename(relative) === name);
      if (placed.length === 0) { details.push(`${name}: se perdió`); continue; }
      if (placed.some(([, found]) => found !== hash)) details.push(`${name}: cambió de contenido`);
      if (placed.every(([relative]) => !relative.includes('/'))) details.push(`${name}: sigue suelto en desorden/`);
    }
    return result(details);
  };
  return {
    goal: 'Organiza esta carpeta en subcarpetas por tipo de fichero. No borres nada.',
    folders: [messy],
    documents: [],
    check,
  };
}

const BUILDERS = { 1: createRecorrido1, 2: createRecorrido2, 3: createRecorrido3 };

export function createRecorrido(n, root) {
  const build = BUILDERS[n];
  if (build === undefined) throw new Error(`createRecorrido: n debe ser 1, 2 o 3, recibido ${JSON.stringify(n)}`);
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error(`createRecorrido: root debe ser una ruta absoluta, recibido ${JSON.stringify(root)}`);
  fs.mkdirSync(root, { recursive: true });
  return build(root);
}
