import type { StatusInfo } from '@shared/status';
import { StatusResponseSchema, toStatusInfo } from './schemas';

// Endpoint de estado de Claude (formato Statuspage). No requiere autenticacion.
const STATUS_ENDPOINT = 'https://status.claude.com/api/v2/summary.json';
// TTL de cache por defecto: el estado cambia poco; 60 s evita golpear el endpoint en cada refresco.
const DEFAULT_CACHE_TTL_MS = 60_000;

// Plazo maximo de una consulta HTTP. Sin el, una conexion colgada deja el panel girando PARA
// SIEMPRE, sin error y sin forma de reintentar. Mismo patron que ya usaba themeMarketService.
const FETCH_TIMEOUT_MS = 15_000;

// Dependencias inyectables -> testeable sin red/reloj reales.
export interface StatusDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly cacheTtlMs?: number;
}

interface CacheEntry {
  readonly fetchedAt: number;
  readonly data: StatusInfo;
}

// Servicio de estado de Claude. Cachea una unica entrada (el estado es global, no por cuenta).
export class StatusService {
  private cache: CacheEntry | null = null;
  private readonly ttlMs: number;

  constructor(private readonly deps: StatusDeps) {
    this.ttlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  // Devuelve el estado del servicio, sirviendo de cache si es reciente (< ttl).
  async getStatus(): Promise<StatusInfo> {
    const nowMs = this.deps.now();
    if (this.cache !== null && nowMs - this.cache.fetchedAt < this.ttlMs) {
      return this.cache.data;
    }
    const response = await this.deps.fetch(STATUS_ENDPOINT, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`El endpoint de estado respondio ${response.status} ${response.statusText}`);
    }

    const parsed = StatusResponseSchema.parse(await response.json());
    const data = toStatusInfo(parsed, nowMs);
    this.cache = { fetchedAt: nowMs, data };
    return data;
  }
}
