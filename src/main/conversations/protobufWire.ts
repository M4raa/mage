// Lector mínimo del formato de cable de protobuf, SIN esquema: agy guarda sus pasos como mensajes protobuf
// dentro de SQLite y no publica los `.proto`. Solo se leen campos por número (medidos con agy 1.2.14/1.3.1);
// lo que no cuadra devuelve null y quien llama lo trata como «no es lo que esperaba», nunca lanza.

export type WireField =
  | { readonly field: number; readonly kind: 'varint'; readonly value: number }
  | { readonly field: number; readonly kind: 'bytes'; readonly value: Uint8Array };

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;
const FIXED64_BYTES = 8;
const FIXED32_BYTES = 4;

function readVarint(buffer: Uint8Array, start: number): { readonly value: number; readonly next: number } | null {
  let value = 0;
  let shift = 0;
  let index = start;
  while (index < buffer.length) {
    const byte = buffer[index]!;
    index += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: index };
    shift += 7;
    if (shift > 63) return null;
  }
  return null;
}

// Campos de un mensaje, en orden. null si los bytes no son un mensaje protobuf bien formado.
export function parseProtobuf(buffer: Uint8Array): readonly WireField[] | null {
  const fields: WireField[] = [];
  let index = 0;
  while (index < buffer.length) {
    const key = readVarint(buffer, index);
    if (key === null) return null;
    index = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (field === 0) return null;
    if (wire === WIRE_VARINT) {
      const value = readVarint(buffer, index);
      if (value === null) return null;
      fields.push({ field, kind: 'varint', value: value.value });
      index = value.next;
    } else if (wire === WIRE_BYTES) {
      const length = readVarint(buffer, index);
      if (length === null || length.next + length.value > buffer.length) return null;
      fields.push({ field, kind: 'bytes', value: buffer.subarray(length.next, length.next + length.value) });
      index = length.next + length.value;
    } else if (wire === WIRE_FIXED64 || wire === WIRE_FIXED32) {
      index += wire === WIRE_FIXED64 ? FIXED64_BYTES : FIXED32_BYTES;
      if (index > buffer.length) return null;
    } else {
      return null;
    }
  }
  return fields;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

// Texto UTF-8 imprimible, o null si los bytes son otra cosa (un mensaje anidado, binario).
export function asText(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  try {
    const text = decoder.decode(bytes);
    return /[\u0000-\u0008\u000e-\u001f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

// Primer campo `number` de tipo bytes de un mensaje.
export function bytesField(fields: readonly WireField[], number: number): Uint8Array | null {
  const found = fields.find((candidate) => candidate.field === number && candidate.kind === 'bytes');
  return found?.kind === 'bytes' ? found.value : null;
}

// Camino de números de campo (`[5, 4, 2]`) hasta un mensaje o un texto. null si algún tramo falta.
export function messageAt(fields: readonly WireField[], path: readonly number[]): readonly WireField[] | null {
  let current: readonly WireField[] | null = fields;
  for (const number of path) {
    const bytes: Uint8Array | null = current === null ? null : bytesField(current, number);
    current = bytes === null ? null : parseProtobuf(bytes);
    if (current === null) return null;
  }
  return current;
}

export function textAt(fields: readonly WireField[], path: readonly number[]): string | null {
  const parentPath = path.slice(0, -1);
  const parent = parentPath.length === 0 ? fields : messageAt(fields, parentPath);
  const bytes = parent === null ? null : bytesField(parent, path[path.length - 1]!);
  return bytes === null ? null : asText(bytes);
}

// Todos los textos legibles de un mensaje, en profundidad (para el resultado de una herramienta, cuyo
// campo exacto cambia con cada tipo de paso).
export function collectTexts(fields: readonly WireField[], depth = 0): string[] {
  const texts: string[] = [];
  for (const field of fields) {
    if (field.kind !== 'bytes') continue;
    // Un mensaje anidado casi siempre lleva bytes de control (las etiquetas de campo son < 0x20), así que un
    // texto sin ellos es texto y no se baja más.
    const text = asText(field.value);
    if (text !== null) {
      texts.push(text);
      continue;
    }
    const nested = depth < MAX_NESTING ? parseProtobuf(field.value) : null;
    if (nested !== null) texts.push(...collectTexts(nested, depth + 1));
  }
  return texts;
}

const MAX_NESTING = 6;

// --- Escritura -------------------------------------------------------------------------------------------------
// Codificador mínimo para los pocos mensajes que Mage escribe en las bases de agy (medidos con `spike/agy-resume-synth-spike.mjs`).

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  return [...out, rest];
}

export function varintField(field: number, value: number): Uint8Array {
  return Uint8Array.from([...encodeVarint(field * 8), ...encodeVarint(value)]);
}

export function bytesFieldOf(field: number, value: Uint8Array): Uint8Array {
  return Uint8Array.from([...encodeVarint(field * 8 + 2), ...encodeVarint(value.length), ...value]);
}

export function textFieldOf(field: number, value: string): Uint8Array {
  return bytesFieldOf(field, new TextEncoder().encode(value));
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}
