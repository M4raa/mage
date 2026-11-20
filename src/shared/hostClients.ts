// Emparejamiento del host local, visto por la ventana: las peticiones pendientes (el diálogo «¿Autorizas…?») y los
// clientes emparejados (Configuración › Hooks y permisos). Nunca lleva tokens ni sus hashes.

export const HOST_CLIENT_KINDS = ['terminal', 'mcp', 'widget'] as const;
export type HostClientKind = (typeof HOST_CLIENT_KINDS)[number];

export interface HostClientView {
  readonly id: string;
  readonly name: string;
  readonly kind: HostClientKind;
  // Fechas ISO UTC.
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface HostPairRequestView {
  readonly requestId: string;
  readonly clientName: string;
  readonly clientKind: HostClientKind;
}

export interface HostPairAnswer {
  readonly requestId: string;
  readonly approve: boolean;
}

// main -> ventana principal: la lista ENTERA de peticiones pendientes cada vez que cambia.
export const HOST_PAIR_REQUESTS_CHANNEL = 'host:pairRequests';
