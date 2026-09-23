import { z } from 'zod';
import type { StatusIncident, StatusIndicator, StatusInfo } from '@shared/status';

// FRONTERA del endpoint summary.json (formato Statuspage). Validacion laxa: solo exigimos tipos
// correctos donde dependemos; el resto se ignora (passthrough) y se rellena con defaults seguros.

const IncidentSchema = z
  .object({
    name: z.string().nullish(),
    status: z.string().nullish(),
    impact: z.string().nullish(),
  })
  .passthrough();

export const StatusResponseSchema = z
  .object({
    status: z
      .object({
        indicator: z.string().nullish(),
        description: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    incidents: z.array(IncidentSchema).nullish(),
  })
  .passthrough();

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

// Indicadores validos de Statuspage; cualquier otro valor se normaliza a 'none' (defensivo).
const VALID_INDICATORS: readonly StatusIndicator[] = ['none', 'minor', 'major', 'critical', 'maintenance'];

// Mapea la respuesta validada al tipo de dominio. Rellena defaults seguros donde falte el campo.
export function toStatusInfo(raw: StatusResponse, fetchedAt: number): StatusInfo {
  const indicator = raw.status?.indicator;
  return {
    indicator: isIndicator(indicator) ? indicator : 'none',
    description: typeof raw.status?.description === 'string' ? raw.status.description : '',
    incidents: (raw.incidents ?? []).map(toIncident),
    fetchedAt,
  };
}

function isIndicator(value: unknown): value is StatusIndicator {
  return typeof value === 'string' && (VALID_INDICATORS as readonly string[]).includes(value);
}

function toIncident(incident: z.infer<typeof IncidentSchema>): StatusIncident {
  return {
    name: typeof incident.name === 'string' ? incident.name : '',
    status: typeof incident.status === 'string' ? incident.status : '',
    impact: typeof incident.impact === 'string' ? incident.impact : '',
  };
}
