// Tipo de dominio del ESTADO de Claude, derivado de GET https://status.claude.com/api/v2/summary.json
// (formato Statuspage). Es lo que cruza el IPC main->renderer para el indicador de la status bar.

// Indicador global de severidad (Statuspage). "none" = todo operativo.
export type StatusIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance';

// Una incidencia abierta (o mantenimiento) reportada por el endpoint.
export interface StatusIncident {
  readonly name: string;
  readonly status: string; // p.ej. "investigating" | "monitoring" | "resolved" ...
  readonly impact: string; // p.ej. "none" | "minor" | "major" | "critical"
}

// Snapshot del estado del servicio. `fetchedAt` es el epoch ms en que se obtuvo.
export interface StatusInfo {
  readonly indicator: StatusIndicator;
  readonly description: string; // texto legible del endpoint (p.ej. "All Systems Operational")
  readonly incidents: readonly StatusIncident[];
  readonly fetchedAt: number; // epoch ms
}
