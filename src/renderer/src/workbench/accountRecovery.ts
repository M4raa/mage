import type { Account } from './types';

// Qué puede hacer el usuario con una cuenta sin login válido (#18). Antes el aviso del sidebar solo
// ofrecía «Eliminar» y solo en las secundarias: una cuenta de Claude caducada (la principal incluida)
// no tenía forma de recuperarse sin recrearla. Iniciar sesión otra vez lo hace el CLI oficial sobre el
// MISMO config dir, así que la cuenta y sus conversaciones se conservan. PURO: testable sin React.
export interface AccountRecovery {
  readonly relogin: boolean; // login de suscripción de Claude por su CLI
  readonly remove: boolean; // nunca la principal
}

type RecoveryInput = Pick<Account, 'isMain' | 'loginStatus' | 'providerId' | 'apiBilled'>;

export function accountRecovery(account: RecoveryInput): AccountRecovery | null {
  if (account.loginStatus === 'logged_in') return null;
  const relogin = account.providerId === 'claude' && !account.apiBilled;
  const remove = !account.isMain;
  return relogin || remove ? { relogin, remove } : null;
}
