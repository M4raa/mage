import type { McpServerStatus } from '@shared/events';
import type { ResolvedMcpServer } from '../../config/mcpResolved';
import type { RuntimeTool } from '../tools/types';
import { mcpRuntimeTool, type McpCallResult, type McpToolInfo } from './mcpTools';

// Los servidores MCP de UNA sesion del runtime propio (P-032 R8): la misma configuracion comun que
// reciben los CLI (`mcp-common.json` y extensiones, ya filtrada por «Solo en…» y sin los desactivados),
// conectada con el SDK oficial. Cada servidor se conecta por su cuenta y en paralelo: uno que falla o
// tarda no tumba a los demas ni a la sesion. Un servidor remoto que pide OAuth sigue en segundo plano
// (`needs-auth`) y sus herramientas llegan cuando el usuario termina en el navegador.

export const MCP_CONNECT_TIMEOUT_MS = 20_000;
export const MCP_CALL_TIMEOUT_MS = 120_000;

// Lo que el pool necesita de un cliente MCP (el `Client` del SDK lo cumple).
export interface McpClientLike {
  listTools(): Promise<{ readonly tools: readonly McpToolInfo[] }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }, schema?: undefined, options?: { signal?: AbortSignal; timeout?: number }): Promise<McpCallResult>;
  close(): Promise<void>;
}

// Conecta un servidor. Lanza `McpNeedsAuth` si el servidor pide iniciar sesion: `authorized` se
// resuelve cuando el usuario termina el OAuth (y entonces se reintenta).
export type McpConnector = (server: ResolvedMcpServer, signal: AbortSignal) => Promise<McpClientLike>;

export class McpNeedsAuth extends Error {
  constructor(
    readonly server: string,
    // El login pendiente (a nivel de app) que abre el boton «Iniciar sesión».
    readonly loginId: string,
    readonly authorized: Promise<void>,
  ) {
    super(`El servidor MCP ${server} pide iniciar sesión`);
    this.name = 'McpNeedsAuth';
  }
}

export interface McpPoolDeps {
  readonly connect: McpConnector;
  // Avisos para el hilo de la conversacion (un servidor que pide login, uno que falla).
  readonly notify: (text: string) => void;
  // Un remoto pide iniciar sesion: la sesion lo dice con un aviso que lleva el boton (D3 de P-033).
  readonly loginRequired: (server: string, loginId: string) => void;
  // Se llama cuando cambian las herramientas o el estado (para volver a anunciar `session_init`).
  readonly onChange: () => void;
  readonly connectTimeoutMs?: number;
  readonly log?: (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
}

interface Entry {
  status: string;
  client: McpClientLike | null;
  tools: RuntimeTool[];
}

export class McpPool {
  private readonly entries = new Map<string, Entry>();
  private readonly controller = new AbortController();
  private closed = false;

  constructor(
    private readonly servers: readonly ResolvedMcpServer[],
    private readonly deps: McpPoolDeps,
  ) {
    for (const server of servers) this.entries.set(server.name, { status: 'pending', client: null, tools: [] });
  }

  // Conecta todos. Nunca lanza: cada fallo queda en el estado de su servidor.
  start(): Promise<void> {
    return Promise.all(this.servers.map((server) => this.connectOne(server))).then(() => undefined);
  }

  statuses(): McpServerStatus[] {
    return [...this.entries].map(([name, entry]) => ({ name, status: entry.status }));
  }

  tools(): RuntimeTool[] {
    return [...this.entries.values()].flatMap((entry) => entry.tools);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    await Promise.all([...this.entries.values()].map((entry) => closeQuietly(entry.client, this.deps.log)));
  }

  private async connectOne(server: ResolvedMcpServer): Promise<void> {
    const entry = this.entries.get(server.name)!;
    const connecting = this.deps.connect(server, this.controller.signal);
    try {
      const client = await withTimeout(connecting, this.deps.connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS, server.name);
      if (this.closed) return void (await closeQuietly(client, this.deps.log));
      const { tools } = await client.listTools();
      entry.client = client;
      entry.tools = tools.map((tool) => mcpRuntimeTool(server.name, tool, (name, args, signal) => this.call(client, name, args, signal)));
      entry.status = 'connected';
    } catch (err) {
      if (err instanceof McpNeedsAuth) return this.awaitAuth(server, entry, err);
      entry.status = 'failed';
      // M1: si venció el tope (o falló `listTools`), el cliente que llegue se cierra: si no, su proceso
      // vivía hasta salir de Mage. Si `connect` fue lo que falló, no hay cliente y ya se ha avisado.
      void connecting.then((late) => closeQuietly(late, this.deps.log), () => undefined);
      const message = err instanceof Error ? err.message : String(err);
      this.deps.log?.('warn', 'Servidor MCP del runtime sin conectar', { server: server.name, message });
      this.deps.notify(`El servidor MCP ${server.name} no se pudo conectar: ${message}`);
    } finally {
      if (!this.closed) this.deps.onChange();
    }
  }

  // OAuth en segundo plano: el usuario abre el login desde el aviso; al volver se reintenta la conexion.
  private awaitAuth(server: ResolvedMcpServer, entry: Entry, pending: McpNeedsAuth): void {
    entry.status = 'needs-auth';
    this.deps.loginRequired(server.name, pending.loginId);
    pending.authorized.then(
      () => (this.closed ? undefined : this.connectOne(server)),
      (err: unknown) => {
        entry.status = 'failed';
        this.deps.notify(`No se completó el inicio de sesión de ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
        if (!this.closed) this.deps.onChange();
      },
    );
  }

  private call(client: McpClientLike, tool: string, args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<McpCallResult> {
    return client.callTool({ name: tool, arguments: { ...args } }, undefined, { signal, timeout: MCP_CALL_TIMEOUT_MS });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, server: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no contestó en ${Math.round(ms / 1000)} s (${server})`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

// Cerrar es limpieza: un fallo al cerrar se registra (no hay nada mas que hacer con el).
async function closeQuietly(client: McpClientLike | null, log: McpPoolDeps['log']): Promise<void> {
  if (client === null) return;
  try {
    await client.close();
  } catch (err) {
    log?.('warn', 'No se pudo cerrar un cliente MCP del runtime', { message: err instanceof Error ? err.message : String(err) });
  }
}
