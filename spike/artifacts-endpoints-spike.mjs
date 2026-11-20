// Mage — Spike: cómo lista y lee artifacts el CLI de Claude Code, y si main puede hacer lo mismo.
//
// Qué mide: las rutas de la «frame API» que usa la herramienta Artifact del CLI (medidas en el binario
// 2.1.319 con `grep -ao`), llamadas desde Node con el token OAuth de UNA cuenta, igual que Mage ya hace
// con el endpoint de uso (`src/main/usage/usageService.ts`):
//   1. la lista `GET /api/frame/artifacts?rel=mine|shared|all&kind=page,document&sort=last_viewed&limit=5`;
//   2. `GET /api/frame/frames?rel=shared&limit=5`;
//   3. la lectura de un artifact: el «boot» `GET /api/frame/<slug>?via=model_read&bk=probe`, que da
//      `{ver, assetToken, …}`, y el contenido en `https://<slug>.frame.claudeusercontent.com/?__frame_t=…`;
//   4. el endpoint MCP `POST /api/artifacts/mcp`: SOLO `initialize` y `tools/list` (nunca `tools/call`).
//
// Cómo se ejecuta:
//   node spike/artifacts-endpoints-spike.mjs --config-dir=<config dir de la cuenta> [--out=<carpeta>]
// `--out` vale por defecto `.verify-out/artifacts-spike` (ignorado por git): ahí van las cabeceras, el
// cuerpo entero de cada respuesta y un `shapes.json` con solo nombres de campos y tipos.
//
// Garantías: solo GET contra la frame API (los dos POST JSON-RPC de solo lectura al MCP aparte); no
// escribe nada en el servidor; como mucho 40 peticiones, separadas 1 s. NUNCA imprime ni guarda el
// token, ni el `assetToken`: la consola solo muestra método, ruta, status y tamaño, y las rutas que se
// guardan van sin la query `__frame_t`. No renueva el token: con un 401 se para y lo dice.
//
// NO es código de producción. Identificadores en inglés, comentarios en castellano.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Versión del CLI contra la que se midieron las rutas y cabeceras (y que va en el User-Agent).
const CLI_VERSION = '2.1.319';
const API_BASE = 'https://api.anthropic.com';
const OAUTH_BETA = 'oauth-2025-04-20';
const FRAME_REFUSAL_TYPE = 'application/vnd.ant.frame-refusal+json';
const LIST_LIMIT = 5;
const REQUEST_GAP_MS = 1000;
const MAX_REQUESTS = 40;
const REL_VALUES = ['mine', 'shared', 'all'];

function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [key, ...rest] = a.slice(2).split('=');
      return [key, rest.join('=')];
    }),
  );
  if (!args['config-dir']) throw new Error(`Falta --config-dir (recibido: ${JSON.stringify(argv)})`);
  const credentialsPath = join(args['config-dir'], '.credentials.json');
  if (!existsSync(credentialsPath)) throw new Error(`No existe ${credentialsPath}`);
  return { credentialsPath, outDir: args.out || join('.verify-out', 'artifacts-spike') };
}

// El token vive solo en memoria: nunca se imprime ni se escribe.
function readAccessToken(credentialsPath) {
  const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const token = parsed?.claudeAiOauth?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`${credentialsPath} no trae claudeAiOauth.accessToken`);
  }
  return token;
}

// Cabeceras de usageService.ts más las de `xu()` del CLI.
function buildHeaders(token, sessionId) {
  return {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': OAUTH_BETA,
    'User-Agent': `claude-code/${CLI_VERSION}`,
    Accept: `application/json, ${FRAME_REFUSAL_TYPE}`,
    'X-Frame-CP': 'go',
    'X-Frame-Surface': 'code',
    'X-Frame-Platform': 'cli',
    'X-Frame-Client-Version': CLI_VERSION,
    'X-Frame-Session-Id': sessionId,
  };
}

function createRecorder(outDir) {
  mkdirSync(outDir, { recursive: true });
  let count = 0;
  let lastAt = 0;
  return async function record({ label, method, url, headers, body, safePath }) {
    if (count >= MAX_REQUESTS) throw new Error(`Tope de ${MAX_REQUESTS} peticiones alcanzado en ${label}`);
    const wait = lastAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    count += 1;
    lastAt = Date.now();
    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    const buffer = Buffer.from(await res.arrayBuffer());
    const n = String(count).padStart(2, '0');
    saveExchange({ outDir, n, label, method, url, safePath, res, buffer });
    console.log(`${method} ${safePath} -> ${res.status} (${buffer.length} B)`);
    return { status: res.status, headers: res.headers, buffer, n };
  };
}

function saveExchange({ outDir, n, label, method, url, safePath, res, buffer }) {
  const contentType = res.headers.get('content-type') ?? '';
  const ext = contentType.includes('json') ? 'json' : contentType.includes('html') ? 'html' : 'bin';
  const responseHeaders = Object.fromEntries(
    [...res.headers.entries()].filter(([k]) => k.toLowerCase() !== 'set-cookie'),
  );
  writeFileSync(join(outDir, `${n}-body.${ext}`), buffer);
  writeFileSync(join(outDir, `${n}-${label}.json`), JSON.stringify({
    method, host: new URL(url).host, path: safePath, status: res.status,
    contentType, bodyBytes: buffer.length, responseHeaders,
  }, null, 2));
}

// Forma de un valor: nombres de campos y tipos, sin contenido. Para las evidencias.
function describeShape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return [`array(${value.length})`, describeShape(mergeObjects(value), depth + 1)];
  }
  if (typeof value !== 'object') return typeof value;
  if (depth > 4) return 'object';
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, describeShape(v, depth + 1)]));
}

function mergeObjects(items) {
  if (!items.every((i) => i !== null && typeof i === 'object' && !Array.isArray(i))) return items[0];
  return Object.assign({}, ...items);
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    return { unparseable: true, reason: String(error.message) };
  }
}

async function measureLists(ctx) {
  const lists = {};
  for (const rel of REL_VALUES) {
    const query = new URLSearchParams({ rel, kind: 'page,document', sort: 'last_viewed', limit: String(LIST_LIMIT) });
    const path = `/api/frame/artifacts?${query}`;
    const res = await ctx.record({ label: `list-${rel}`, method: 'GET', url: API_BASE + path, headers: ctx.headers, safePath: path });
    lists[rel] = { status: res.status, json: parseJson(res.buffer) };
    if (res.status === 401) throw new Error('401 en la primera lista: token caducado; renuévalo con el CLI y repite');
  }
  const framesPath = `/api/frame/frames?rel=shared&limit=${LIST_LIMIT}`;
  const frames = await ctx.record({ label: 'frames-shared', method: 'GET', url: API_BASE + framesPath, headers: ctx.headers, safePath: framesPath });
  lists.framesShared = { status: frames.status, json: parseJson(frames.buffer) };
  return lists;
}

function pickSlug(lists) {
  for (const rel of ['mine', 'shared']) {
    const rows = lists[rel]?.json?.artifacts;
    if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].id === 'string') return { slug: rows[0].id, rel };
  }
  return null;
}

async function measureRead(ctx, slug) {
  const bootPath = `/api/frame/${encodeURIComponent(slug)}?via=model_read&bk=probe`;
  const boot = await ctx.record({ label: 'read-boot', method: 'GET', url: API_BASE + bootPath, headers: ctx.headers, safePath: bootPath });
  const bootJson = parseJson(boot.buffer);
  const result = { bootStatus: boot.status, boot: bootJson, content: [] };
  const { assetToken, ver } = bootJson ?? {};
  const entry = Array.isArray(bootJson?.files) ? bootJson.files[0]?.path : undefined;
  if (boot.status !== 200 || typeof assetToken !== 'string' || typeof ver !== 'string' || !entry) return result;
  // El contenido va al host propio del artifact, SIN OAuth: `/_f/<ver>/<fichero>?__frame_t=<assetToken>`
  // (la `V` del CLI 2.1.319). `/` y `/index.html` sin versión responden 404.
  const servedPath = `/_f/${encodeURIComponent(ver)}/${entry}`;
  const url = `https://${slug}.frame.claudeusercontent.com${servedPath}?__frame_t=${encodeURIComponent(assetToken)}`;
  const res = await ctx.record({ label: 'read-content', method: 'GET', url, headers: { 'User-Agent': `claude-code/${CLI_VERSION}` }, safePath: '/_f/<ver>/<fichero> (sin __frame_t)' });
  result.content.push({ status: res.status, bytes: res.buffer.length, contentType: res.headers.get('content-type') });
  return result;
}

async function measureMcp(ctx) {
  const url = `${API_BASE}/api/artifacts/mcp`;
  const headers = { ...ctx.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const calls = [
    { label: 'mcp-initialize', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'artifacts-spike', version: '0' } } } },
    { label: 'mcp-tools-list', body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } },
  ];
  const out = {};
  for (const call of calls) {
    const res = await ctx.record({ label: call.label, method: 'POST', url, headers, body: JSON.stringify(call.body), safePath: `/api/artifacts/mcp (${call.body.method})` });
    out[call.label] = { status: res.status, json: parseJson(res.buffer) };
  }
  return out;
}

function summarize(lists, picked, read, mcp) {
  const shapes = {};
  for (const [key, value] of Object.entries(lists)) shapes[key] = { status: value.status, shape: describeShape(value.json) };
  if (read) shapes.readBoot = { status: read.bootStatus, shape: describeShape(read.boot), content: read.content, pickedFrom: picked.rel };
  for (const [key, value] of Object.entries(mcp)) shapes[key] = { status: value.status, shape: describeShape(value.json) };
  return shapes;
}

async function main() {
  const { credentialsPath, outDir } = parseArgs(process.argv.slice(2));
  const token = readAccessToken(credentialsPath);
  const ctx = { headers: buildHeaders(token, randomUUID()), record: createRecorder(outDir) };
  const lists = await measureLists(ctx);
  const picked = pickSlug(lists);
  const read = picked ? await measureRead(ctx, picked.slug) : null;
  const mcp = await measureMcp(ctx);
  writeFileSync(join(outDir, 'shapes.json'), JSON.stringify(summarize(lists, picked, read, mcp), null, 2));
  console.log(`Formas (sin contenido) en ${join(outDir, 'shapes.json')}`);
}

main().catch((error) => {
  console.error(`spike: ${error.message}`);
  process.exitCode = 1;
});
