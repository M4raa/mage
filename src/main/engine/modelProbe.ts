import type { ProviderModel } from '@shared/providers';
import { normalizeRawEvent } from './normalize';

// Sondeo del catalogo de modelos de una cuenta SIN gastar un turno (P-026 2.4, D7): se lanza el CLI con
// los argumentos de siempre, se le pide SOLO `initialize` y se cierra. Es el patron de
// `spike/init-spike.mjs`, que midio en 2.1.283 que la respuesta trae `models` en headless y tarda
// 0,6–1,6 s. Se usa al arrancar Mage y al añadir una cuenta, para que el selector tenga los modelos
// reales antes de la primera conversacion (el `initialize` de cada sesion los refresca despues).
//
// Nunca se manda un mensaje de usuario. Al acabar se cierra la entrada (el CLI sale solo, y con el sus
// servidores MCP); solo si no sale en `exitGraceMs` se mata el arbol.

export interface ProbeProcess {
  // Los sondeos RPC pueden distinguir un error de transporte de una salida del proceso.
  onError?(listener: () => void): void;
  onStdout(listener: (chunk: string) => void): void;
  // Tambien cuando el proceso no llega a arrancar (binario ausente).
  onExit(listener: () => void): void;
  writeLine(line: string): void;
  endInput(): void;
  killTree(): void;
}

export interface ModelProbeDeps {
  readonly spawnProbe: (configDir: string) => ProbeProcess;
  readonly timeoutMs: number;
  readonly exitGraceMs: number;
}

const PROBE_REQUEST_ID = 'mage-model-probe';
const INITIALIZE_REQUEST = JSON.stringify({ type: 'control_request', request_id: PROBE_REQUEST_ID, request: { subtype: 'initialize' } });

// Modelos de la cuenta, o null si el sondeo fallo (plazo vencido, el CLI salio antes, respuesta de
// error). Nunca lanza: un sondeo fallido deja la cache anterior, y quien llama lo registra.
export function probeModelCatalog(deps: ModelProbeDeps, configDir: string): Promise<readonly ProviderModel[] | null> {
  return new Promise((resolve) => {
    const child = deps.spawnProbe(configDir);
    const state = { settled: false, exited: false, buffer: '' };
    const settle = (models: readonly ProviderModel[] | null): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(deadline);
      resolve(models);
      closeGracefully(child, state, deps.exitGraceMs);
    };
    const deadline = setTimeout(() => settle(null), deps.timeoutMs);
    child.onExit(() => {
      state.exited = true;
      settle(null);
    });
    child.onStdout((chunk) => {
      state.buffer += chunk;
      const { lines, rest } = splitLines(state.buffer);
      state.buffer = rest;
      for (const line of lines) {
        const models = modelsFromResponse(line);
        if (models !== undefined) settle(models);
      }
    });
    child.writeLine(INITIALIZE_REQUEST);
  });
}

// Sondea varias cuentas EN SERIE (nunca en paralelo: cada sondeo es un CLI entero, y al arrancar Mage
// compiten con la ventana). Cada resultado bueno se entrega en cuanto llega.
export async function probeModelCatalogs(
  deps: ModelProbeDeps,
  configDirs: readonly string[],
  onResult: (configDir: string, models: readonly ProviderModel[] | null) => void,
): Promise<void> {
  for (const configDir of configDirs) {
    onResult(configDir, await probeModelCatalog(deps, configDir));
  }
}

function closeGracefully(child: ProbeProcess, state: { readonly exited: boolean }, graceMs: number): void {
  if (state.exited) return;
  child.endInput();
  setTimeout(() => {
    if (!state.exited) child.killTree();
  }, graceMs);
}

function splitLines(buffer: string): { readonly lines: readonly string[]; readonly rest: string } {
  const parts = buffer.split('\n');
  return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] ?? '' };
}

// La respuesta a NUESTRO `initialize`: sus modelos (vacio si no trae), null si el CLI la rechazo, o
// undefined si la linea es otra cosa (hooks, avisos, una linea que no es JSON).
function modelsFromResponse(line: string): readonly ProviderModel[] | null | undefined {
  const raw = parseJson(line);
  if (!isRecord(raw) || raw.type !== 'control_response' || !isRecord(raw.response)) return undefined;
  if (raw.response.request_id !== PROBE_REQUEST_ID) return undefined;
  if (raw.response.subtype === 'error') return null;
  let events;
  try {
    events = normalizeRawEvent(raw);
  } catch {
    // Respuesta nuestra con una forma que el esquema rechaza: el sondeo FALLA (null), y quien llama lo
    // registra. Nunca puede lanzar desde aqui: estamos dentro del listener de stdout del proceso.
    return null;
  }
  const event = events.find((e) => e.kind === 'models_available');
  return event?.kind === 'models_available' ? event.models : [];
}

// El CLI solo escribe NDJSON en stdout, pero una linea que no lo sea no puede tumbar el sondeo: no es
// la respuesta que se espera y se sigue leyendo.
function parseJson(line: string): unknown {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
