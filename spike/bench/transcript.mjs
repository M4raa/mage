// Benchmark F0-B (H3 de la devolución 13): peticiones al modelo de una sesión de Claude, leídas de la
// transcripción que escribe el propio CLI en su config dir (igual en R2 y R3). Cada petición a la API es
// un `message.id` del asistente; el CLI escribe una entrada por bloque de contenido con el mismo id y el
// mismo `usage`, así que se agrupan por id. Así se separa el contexto fijo (la PRIMERA petición) del
// número de rondas, que el `result` del CLI suma sin distinguir.
import fs from 'node:fs';
import path from 'node:path';

// Transcripción de `sessionId` bajo `<configDir>/projects/*/`; null si el CLI no la escribió.
export function findTranscript(configDir, sessionId) {
  const projects = path.join(configDir, 'projects');
  if (!fs.existsSync(projects)) return null;
  for (const slug of fs.readdirSync(projects)) {
    const file = path.join(projects, slug, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// [{ id, input, cacheRead, cacheCreate, output }] en orden de llegada, una por petición.
export function requestsOf(jsonl) {
  const byId = new Map();
  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const entry = JSON.parse(line);
    const message = entry.type === 'assistant' ? entry.message : undefined;
    if (message?.id === undefined || message.usage === undefined || byId.has(message.id)) continue;
    const u = message.usage;
    byId.set(message.id, { id: message.id, input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 });
  }
  return [...byId.values()];
}

// Métricas para la fila del benchmark: rondas y tokens de entrada de la primera petición. Sin
// transcripción, las dos a null (se registra, no se inventa).
export function roundsOf(configDir, sessionId) {
  const file = findTranscript(configDir, sessionId);
  if (file === null) return { rounds: null, firstRequestTokens: null };
  const requests = requestsOf(fs.readFileSync(file, 'utf8'));
  const first = requests[0];
  return { rounds: requests.length, firstRequestTokens: first === undefined ? null : first.input + first.cacheRead + first.cacheCreate };
}

// Resumen del `init` del CLI (R2: el mensaje crudo; R3: el `session_init` normalizado de Mage): qué
// herramientas, servidores MCP, skills y plugins ve el modelo en cada ruta.
export function initSummary(init) {
  if (init === '' || init === undefined) return null;
  const m = JSON.parse(init);
  const names = (list) => (list ?? []).map((item) => (typeof item === 'string' ? item : item.name)).sort();
  return {
    tools: names(m.tools),
    mcpServers: names(m.mcp_servers ?? m.mcpServers),
    skills: names(m.skills),
    plugins: names(m.plugins),
    slashCommands: (m.slash_commands ?? m.slashCommands ?? []).length,
  };
}
