import { inflateRawSync } from 'node:zlib';

// Lector ZIP minimo para leer ficheros concretos de un `.vsix` (que es un ZIP). Necesario porque el
// endpoint `/file/<ruta>` de Open VSX solo sirve ficheros REGISTRADOS (package.json, README, icon…) y
// da 404 para los anidados como `theme/dracula.json`; el .vsix si los contiene. PURO (Buffer -> texto),
// testeable. Soporta los dos metodos habituales: almacenado (0) y deflate (8). Sin dependencias.

const EOCD_SIG = 0x06054b50; // End Of Central Directory
const CDH_SIG = 0x02014b50; // Central Directory Header
const LFH_SIG = 0x04034b50; // Local File Header
const EOCD_MIN = 22; // tamaño minimo del EOCD (sin comentario)
const MAX_COMMENT = 0xffff;
// Tope de bytes descomprimidos por miembro. Un tema de VS Code son decenas de KB; 8 MB deja sitio de
// sobra para el mas gordo y a la vez acota lo que un `.vsix` malicioso puede hacerle al proceso main.
const MAX_MEMBER_BYTES = 8 * 1024 * 1024;

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

// Extrae el texto (UTF-8) del PRIMER miembro cuyo nombre termina en `suffix` (normalizado con '/',
// case-insensitive). Asi da igual el prefijo `extension/` del vsix. Lanza si no existe (contrato de
// error explicito, nunca silencioso).
export function readZipMemberText(zip: Buffer, suffix: string): string {
  const target = normalizeMember(suffix);
  const entries = readCentralDirectory(zip);
  const entry = entries.find((e) => normalizeMember(e.name).endsWith(target));
  if (entry === undefined) {
    throw new Error(`El .vsix no contiene ningun fichero que termine en "${suffix}"`);
  }
  return inflateEntry(zip, entry).toString('utf8');
}

function normalizeMember(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
}

// Localiza el EOCD buscando su firma desde el final (el comentario final puede tener hasta 65535 bytes).
function findEocd(zip: Buffer): number {
  const minStart = Math.max(0, zip.length - EOCD_MIN - MAX_COMMENT);
  for (let i = zip.length - EOCD_MIN; i >= minStart; i -= 1) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('ZIP invalido: no se encontro el End Of Central Directory');
}

// Recorre el directorio central y devuelve los metadatos de cada entrada.
function readCentralDirectory(zip: Buffer): CentralEntry[] {
  const eocd = findEocd(zip);
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== CDH_SIG) {
      throw new Error(`ZIP invalido: cabecera de directorio central inesperada en offset ${offset}`);
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Localiza los datos de una entrada por su cabecera local y los descomprime (store o deflate).
function inflateEntry(zip: Buffer, entry: CentralEntry): Buffer {
  const lho = entry.localHeaderOffset;
  if (zip.readUInt32LE(lho) !== LFH_SIG) {
    throw new Error(`ZIP invalido: cabecera local inesperada para "${entry.name}"`);
  }
  const nameLen = zip.readUInt16LE(lho + 26);
  const extraLen = zip.readUInt16LE(lho + 28);
  const dataStart = lho + 30 + nameLen + extraLen;
  const data = zip.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data); // almacenado (sin comprimir)
  // Tope de salida: el `.vsix` viene de un registro ABIERTO (cualquiera publica) y esto corre en el
  // proceso main, sincrono. Sin limite, un miembro con ratio de bomba lo bloquea o lo tumba por OOM.
  // Un tema de VS Code son KB; el tope va holgado para no rechazar ninguno legitimo.
  if (entry.uncompressedSize > MAX_MEMBER_BYTES) {
    throw new Error(`Miembro del ZIP demasiado grande ("${entry.name}": ${entry.uncompressedSize} bytes)`);
  }
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_MEMBER_BYTES }); // deflate
  throw new Error(`Metodo de compresion no soportado (${entry.method}) para "${entry.name}"`);
}
