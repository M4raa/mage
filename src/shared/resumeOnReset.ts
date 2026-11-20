import type { AccountAuthKind } from './accounts';

// «Continuar al restablecerse» solo existe para Claude por SUSCRIPCIÓN: es la única con una ventana de 5 h que se levanta
// sola. Codex, agy, el runtime propio y las cuentas de API no la tienen. Lo comparten main (que rechaza el resto) y la
// pestaña (que no pinta la opción).
export function supportsResumeOnReset(provider: string, authKind: AccountAuthKind | undefined): boolean {
  return provider === 'claude' && authKind === 'subscription';
}
