import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { McpAgyChange, McpAgySyncPreview, McpAgySyncResult, McpAgySyncState } from '@shared/mcp';
import { writeAtomicIfUnchanged, type AtomicWriteDeps } from '../os/atomicFile';
import type { ResolvedMcpServer } from './mcpResolved';
import { hasVaultSecrets, toAgyEntry } from './mcpProviderTranslate';

// «Sincronizar con agy» (decision C3-j). agy no tiene flag de sesion para MCP (medido en 1.2.14: ni
// `--mcp-config` ni `--settings`), asi que lo que Mage comparte con agy se EXPORTA a su
// `~/.gemini/config/mcp_config.json`. Reglas:
//  - Mage solo toca SUS entradas: las que exporto la ultima vez (la lista vive en el estado de Mage, no
//    en el fichero de agy). Una entrada con el mismo nombre que no exporto Mage se deja y se avisa;
//  - antes de escribir, copia del fichero en la carpeta de Mage; y compare-and-swap contra lo leido
//    en la vista previa (el usuario puede estar usando `agy mcp add` a la vez);
//  - si el usuario desactivo en agy una entrada exportada (`agy mcp disable`), se respeta.
// Los valores de `env`/cabeceras quedan en claro en el fichero de agy, igual que con `agy mcp add`.

const STATE = z.object({
  auto: z.boolean().catch(false),
  exported: z.array(z.string()).catch([]),
  secretsConfirmed: z.array(z.string()).catch([]),
  lastSyncAt: z.string().nullable().catch(null),
  lastError: z.string().nullable().catch(null),
});

const DEFAULT_STATE: McpAgySyncState = { auto: false, exported: [], secretsConfirmed: [], lastSyncAt: null, lastError: null };
const BACKUPS_KEPT = 10;

export interface AgySyncPlan {
  readonly text: string | null; // null = no hay nada que escribir
  readonly changes: readonly McpAgyChange[];
  readonly exported: readonly string[];
}

// PURO. `currentText` null = el fichero no existe. Un fichero que no es JSON con `mcpServers` LANZA:
// escribir sobre lo que no se entiende es como se pierde configuracion ajena.
// `secretsConfirmed`: servidores con valores de la BOVEDA que el usuario acepto copiar en claro al
// fichero de agy. Los demas con valores de la boveda no se copian (y si estaban, se quitan).
export function planAgySync(
  currentText: string | null,
  servers: readonly ResolvedMcpServer[],
  previouslyExported: readonly string[],
  secretsConfirmed: ReadonlySet<string> = new Set(),
): AgySyncPlan {
  const root = parseAgyRoot(currentText);
  const current = isRecord(root.mcpServers) ? root.mcpServers : {};
  const next: Record<string, unknown> = { ...current };
  const mine = new Set(previouslyExported);
  const changes: McpAgyChange[] = [];
  const exported: string[] = [];
  for (const server of servers) {
    const change = hasVaultSecrets(server) && !secretsConfirmed.has(server.name) ? secretSkip(server.name) : planServer(server, next, mine);
    if (change.action === 'skip') changes.push(change);
    else exported.push(server.name);
    if (change.action === 'add' || change.action === 'update') changes.push(change);
  }
  const wanted = new Set(exported);
  for (const name of previouslyExported) {
    if (wanted.has(name) || !Object.hasOwn(next, name)) continue;
    delete next[name];
    changes.push({ name, action: 'remove', reason: null });
  }
  const written = changes.some((change) => change.action !== 'skip');
  return { text: written ? `${JSON.stringify({ ...root, mcpServers: next }, null, 2)}\n` : null, changes, exported };
}

function secretSkip(name: string): McpAgyChange {
  return { name, action: 'skip', reason: 'lleva valores guardados en la bóveda: solo se copia si lo confirmas, y quedarían en claro en el fichero de agy' };
}

// Servidores que solo se copian con confirmacion (para el dialogo).
export function serversNeedingSecretConfirmation(servers: readonly ResolvedMcpServer[]): readonly string[] {
  return servers.filter(hasVaultSecrets).map((server) => server.name);
}

// `none` = ya estaba igual (sigue siendo de Mage, sin cambio que enseñar).
function planServer(server: ResolvedMcpServer, next: Record<string, unknown>, mine: ReadonlySet<string>): McpAgyChange | { readonly action: 'none' } {
  const entry = toAgyEntry(server);
  if (entry === null) return { name: server.name, action: 'skip', reason: 'agy no admite servidores SSE' };
  const existing = next[server.name];
  if (existing !== undefined && !mine.has(server.name)) {
    return { name: server.name, action: 'skip', reason: 'agy ya tiene uno con ese nombre que no puso Mage' };
  }
  const disabled = isRecord(existing) && existing.disabled === true;
  const wanted = { ...entry, disabled };
  if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(wanted)) return { action: 'none' };
  next[server.name] = wanted;
  return { name: server.name, action: existing === undefined ? 'add' : 'update', reason: null };
}

function parseAgyRoot(text: string | null): Record<string, unknown> {
  if (text === null || text.trim().length === 0) return { mcpServers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`El mcp_config.json de agy no es JSON válido (${text.length} caracteres): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`El mcp_config.json de agy no es un objeto JSON (${text.length} caracteres)`);
  return parsed;
}

export function agyConfigVersion(text: string | null): string | null {
  return text === null ? null : createHash('sha256').update(text).digest('hex');
}

// --- Servicio con FS inyectado ------------------------------------------------------------------

export interface AgySyncDeps {
  readonly configPath: string; // mcp_config.json de agy
  readonly statePath: string; // agy-sync.json de Mage
  readonly backupDir: string;
  readonly fs: AtomicWriteDeps & {
    readonly mkdir: (path: string) => void;
    readonly listDir: (path: string) => readonly string[];
    readonly removeFile: (path: string) => void;
  };
  readonly now: () => Date;
  // Lo que Mage comparte con agy (ya filtrado por «Solo en…»).
  readonly servers: () => readonly ResolvedMcpServer[];
}

export class AgySyncService {
  constructor(private readonly deps: AgySyncDeps) {}

  state(): McpAgySyncState {
    const text = this.readText(this.deps.statePath);
    if (text === null) return DEFAULT_STATE;
    // Estado ilegible = por defecto (sin exportados), dicho en `lastError`: lo que Mage exporto pasa a
    // tratarse como ajeno, que es el lado que no borra nada del fichero de agy.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { ...DEFAULT_STATE, lastError: `agy-sync.json ilegible: ${error instanceof Error ? error.message : String(error)}` };
    }
    const result = STATE.safeParse(parsed);
    return result.success ? result.data : { ...DEFAULT_STATE, lastError: "agy-sync.json con forma inesperada" };
  }

  setAuto(auto: boolean): McpAgySyncState {
    return this.writeState({ ...this.state(), auto });
  }

  // Vista previa con los confirmados que propone el dialogo (por defecto, los ya guardados).
  preview(secretsConfirmed?: readonly string[]): McpAgySyncPreview {
    const text = this.readText(this.deps.configPath);
    const state = this.state();
    const servers = this.deps.servers();
    const confirmed = secretsConfirmed ?? state.secretsConfirmed;
    const plan = planAgySync(text, servers, state.exported, new Set(confirmed));
    return {
      path: this.deps.configPath,
      changes: plan.changes,
      expected: agyConfigVersion(text),
      secretServers: serversNeedingSecretConfirmation(servers),
      secretsConfirmed: confirmed,
    };
  }

  // `secretsConfirmed`: lo que el usuario marco en el dialogo (sustituye a lo guardado). Ausente = lo
  // guardado (sincronizacion automatica: nunca confirma nada por su cuenta).
  apply(expected: string | null, secretsConfirmed?: readonly string[]): McpAgySyncResult {
    if (secretsConfirmed !== undefined) this.writeState({ ...this.state(), secretsConfirmed: [...secretsConfirmed] });
    const text = this.readText(this.deps.configPath);
    if (agyConfigVersion(text) !== expected) {
      return { status: 'stale', message: 'El mcp_config.json de agy ha cambiado desde la vista previa. Revisa los cambios otra vez.' };
    }
    const state = this.state();
    const plan = planAgySync(text, this.deps.servers(), state.exported, new Set(state.secretsConfirmed));
    const backupPath = plan.text === null || text === null ? null : this.backup(text);
    if (plan.text !== null) {
      this.deps.fs.mkdir(dirname(this.deps.configPath));
      const written = writeAtomicIfUnchanged(this.deps.fs, this.deps.configPath, plan.text, text);
      if (written.status === 'stale') return { status: 'stale', message: 'agy escribió su mcp_config.json mientras Mage sincronizaba. Vuelve a intentarlo.' };
    }
    this.writeState({ ...this.state(), exported: plan.exported, lastSyncAt: this.deps.now().toISOString(), lastError: null });
    return { status: 'saved', changes: plan.changes, backupPath };
  }

  // Sincronizacion automatica tras un cambio de Mage (si esta activada). Un fallo se guarda en el
  // estado para que Ajustes lo enseñe; nunca se traga.
  autoSync(): McpAgySyncResult | null {
    const state = this.state();
    if (!state.auto) return null;
    try {
      const result = this.apply(agyConfigVersion(this.readText(this.deps.configPath)));
      if (result.status === 'stale') this.writeState({ ...this.state(), lastError: result.message });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeState({ ...this.state(), lastError: message });
      return { status: 'stale', message };
    }
  }

  private backup(text: string): string {
    this.deps.fs.mkdir(this.deps.backupDir);
    const stamp = this.deps.now().toISOString().replace(/[:.]/g, '-');
    const path = join(this.deps.backupDir, `mcp_config-${stamp}.json`);
    this.deps.fs.writeFile(path, text);
    const old = this.deps.fs
      .listDir(this.deps.backupDir)
      .filter((name) => name.startsWith('mcp_config-'))
      .sort()
      .slice(0, -BACKUPS_KEPT);
    for (const name of old) this.deps.fs.removeFile(join(this.deps.backupDir, name));
    return path;
  }

  private writeState(state: McpAgySyncState): McpAgySyncState {
    this.deps.fs.mkdir(dirname(this.deps.statePath));
    this.deps.fs.writeFile(this.deps.statePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }

  private readText(path: string): string | null {
    return this.deps.fs.exists(path) ? this.deps.fs.readFile(path) : null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
