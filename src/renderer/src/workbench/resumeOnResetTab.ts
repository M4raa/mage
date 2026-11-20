import { supportsResumeOnReset } from '@shared/resumeOnReset';
import type { Account, Tab } from './types';

// ¿Se ofrece «Continuar al restablecerse» en esta pestaña? Solo en Claude por suscripción; sin la cuenta a la vista
// (aún cargando, o borrada) no se sabe cómo factura y no se ofrece.
export function offersResumeOnReset(tab: Pick<Tab, 'provider' | 'accountId'> | undefined, accounts: readonly Account[]): boolean {
  if (tab === undefined) return false;
  const account = accounts.find((candidate) => candidate.id === tab.accountId);
  if (account === undefined) return false;
  return supportsResumeOnReset(tab.provider, account.apiBilled ? 'api-key' : 'subscription');
}

// La pestaña con la opción puesta o quitada: `false` quita el campo, como los demás ajustes opcionales.
export function withResumeOnReset(tab: Tab, enabled: boolean): Tab {
  const { resumeOnReset: _dropped, ...rest } = tab;
  return enabled ? { ...rest, resumeOnReset: true } : rest;
}
