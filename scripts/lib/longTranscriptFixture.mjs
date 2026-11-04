// Fixture de una transcripcion LARGA del runtime propio de Mage, para medir en produccion (donde no hay
// puente de desarrollo `__mageDev`): `<userData>/runtime/projects/<cwd codificado>/<id>.jsonl`, que el
// historial del lateral ya lista y que se abre solo leyendo el fichero (sin lanzar ningun motor).
import fs from 'node:fs';
import path from 'node:path';

export const LONG_TRANSCRIPT_SESSION_ID = '7e570000-0000-4000-8000-000000000003';
const START_MS = Date.UTC(2026, 10, 1);
const LINE_STEP_MS = 1000;
const UUID_PREFIX = '00000000-0000-4000-8000-';
const UUID_DIGITS = 12;
const MODEL = 'vg-t3-model';
// Tokens ficticios de cada vuelta de asistente (enteros, solo para que la linea tenga la forma real).
const FAKE_USAGE = { input_tokens: 10, output_tokens: 10 };
// El mismo parrafo Markdown que usa `measureLongConversation` en perfBaseline.mjs.
const PARAGRAPH = 'Párrafo de prueba con **negrita**, `código` y una lista:\n\n- uno\n- dos\n\n' + 'Texto largo de relleno. '.repeat(20);

// Misma regla que `encodeProjectFolderName` de src/main/transcripts/transcriptPath.ts: cada caracter no
// alfanumerico pasa a `-`, sin colapsar.
export function encodeProjectFolderName(cwd) {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error(`cwd invalido para codificar la carpeta: ${JSON.stringify(cwd)}`);
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function longTranscriptTitle(blocks) {
  return `VG-T3 · conversación de ${blocks} bloques`;
}

function uuidOf(index) {
  return `${UUID_PREFIX}${String(index).padStart(UUID_DIGITS, '0')}`;
}

// Misma forma que escribe `TranscriptWriter.write()`: la linea de `user()` y la `assistant` de una vuelta
// con solo texto (src/main/runtime/transcriptWriter.ts).
function lineAt(index, { sessionId, cwd, blocks, startMs }) {
  const isUser = index % 2 === 0;
  const text = isUser ? (index === 0 ? longTranscriptTitle(blocks) : `Mensaje ${index}: ${PARAGRAPH}`) : `Respuesta ${index}: ${PARAGRAPH}`;
  const message = isUser
    ? { role: 'user', content: text }
    : { role: 'assistant', model: MODEL, content: [{ type: 'text', text }], usage: FAKE_USAGE };
  return JSON.stringify({
    type: isUser ? 'user' : 'assistant',
    message,
    uuid: uuidOf(index),
    parentUuid: index === 0 ? null : uuidOf(index - 1),
    isSidechain: false,
    timestamp: new Date(startMs + index * LINE_STEP_MS).toISOString(),
    sessionId,
    cwd,
  });
}

// Devuelve las lineas JSON (strings, sin salto final). `blocks` par y > 0: alterna usuario/asistente.
export function buildLongTranscript({ sessionId, cwd, blocks, startMs }) {
  if (!Number.isInteger(blocks) || blocks <= 0 || blocks % 2 !== 0) throw new Error(`blocks debe ser un entero par y mayor que 0: ${JSON.stringify(blocks)}`);
  return Array.from({ length: blocks }, (_, index) => lineAt(index, { sessionId, cwd, blocks, startMs }));
}

// Escribe la transcripcion bajo el userData del perfil aislado y crea `cwd` si no existe.
export function writeLongTranscript(userDataDir, { cwd, blocks }) {
  fs.mkdirSync(cwd, { recursive: true });
  const dir = path.join(userDataDir, 'runtime', 'projects', encodeProjectFolderName(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const sessionId = LONG_TRANSCRIPT_SESSION_ID;
  const file = path.join(dir, `${sessionId}.jsonl`);
  const lines = buildLongTranscript({ sessionId, cwd, blocks, startMs: START_MS });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');
  return { sessionId, file, title: longTranscriptTitle(blocks) };
}
