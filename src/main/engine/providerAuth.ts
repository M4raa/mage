import type { ProviderAuthSummary } from '@shared/providers';
import type { ProviderAdapter } from './providerAdapter';

// Resumen de COMO se da de alta cada proveedor, para el dialogo «Añadir cuenta» (P-028, punto 41).
// PURO: recibe los proveedores y la fabrica de adapters. Lo que sale son solo cadenas descriptivas
// (id, nombre, tipo y el motivo que declara el propio adapter): nunca una clave ni un token — el
// `apiKey` de los proveedores del usuario ni siquiera entra aqui.
export function providerAuthSummary(
  providers: readonly { readonly id: string; readonly label: string }[],
  buildAdapter: (providerId: string) => ProviderAdapter,
): ProviderAuthSummary[] {
  return providers.map(({ id, label }) => {
    const { auth } = buildAdapter(id);
    switch (auth.kind) {
      case 'cli-oauth':
        return { providerId: id, label, kind: auth.kind, reason: '' };
      case 'api-key':
        return { providerId: id, label, kind: auth.kind, reason: auth.keyLabel };
      case 'external':
        return { providerId: id, label, kind: auth.kind, reason: auth.reason };
    }
  });
}
