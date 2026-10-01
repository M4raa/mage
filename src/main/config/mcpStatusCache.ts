import { z } from 'zod';
import type { McpLiveStatus, McpStatusByAccount, McpStatusCache } from '@shared/mcp';

// Ultimo estado de los MCP de cada cuenta con su fecha (decision C3-e), en `userData/mcp-status-cache.json`.
// Asi los conectores se ven sin sondear al abrir Mage. Solo nombre, estado y scope: NUNCA `config`
// (en los remotos trae `headers`). PURO.

const STATUS = z.object({ name: z.string().min(1), status: z.string(), scope: z.string().nullable().catch(null) });
const SNAPSHOT = z.object({ checkedAt: z.string().datetime(), servers: z.array(STATUS) });
const CACHE = z.record(z.string(), SNAPSHOT);

// Ausente, ilegible o con otra forma -> vacia: es una cache, perderla solo obliga a volver a comprobar.
// Se dice en el aviso (sin el contenido).
export function parseStatusCache(text: string | null, warn: (message: string) => void): McpStatusCache {
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    warn(`mcp-status-cache.json ilegible (${text.length} caracteres), se ignora: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
  const result = CACHE.safeParse(parsed);
  if (result.success) return result.data;
  warn(`mcp-status-cache.json con forma inesperada, se ignora: ${result.error.issues.length} problemas`);
  return {};
}

// Lo nuevo de un sondeo (o de un «Autenticar») sustituye a lo guardado de ESAS cuentas; las demas se
// quedan con lo que tenian.
export function mergeStatusCache(cache: McpStatusCache, fresh: McpStatusByAccount, now: Date): McpStatusCache {
  const checkedAt = now.toISOString();
  const updates = Object.fromEntries(Object.entries(fresh).map(([accountDir, servers]) => [accountDir, { checkedAt, servers: servers.map(stripStatus) }]));
  return { ...cache, ...updates };
}

// Solo las cuentas que Mage conoce: una cuenta borrada no se queda en la cache para siempre.
export function pruneStatusCache(cache: McpStatusCache, accountDirs: readonly string[]): McpStatusCache {
  const known = new Set(accountDirs);
  return Object.fromEntries(Object.entries(cache).filter(([accountDir]) => known.has(accountDir)));
}

export function statusesOf(cache: McpStatusCache): McpStatusByAccount {
  return Object.fromEntries(Object.entries(cache).map(([accountDir, snapshot]) => [accountDir, snapshot.servers]));
}

function stripStatus(status: McpLiveStatus): McpLiveStatus {
  return { name: status.name, status: status.status, scope: status.scope };
}
