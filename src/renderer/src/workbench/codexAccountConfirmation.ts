import type { AccountInfo } from '@shared/accounts';
import type { MageApi } from '@shared/ipc';
import type { Account } from './types';

export function confirmCodexAccounts(mage: MageApi, infos: readonly AccountInfo[], receive: (infos: readonly AccountInfo[]) => void): void {
  if (!infos.some((info) => info.providerId === 'codex' && info.authKind === 'subscription' && info.loginStatus !== 'logged_out')) return;
  void mage.confirmCodexAccounts().then(receive).catch(() => console.warn('No se pudo confirmar el login de Codex.'));
}

export function applyCodexConfirmation(accounts: readonly Account[], infos: readonly AccountInfo[]): Account[] {
  const confirmed = new Map(infos.filter((info) => info.providerId === 'codex' && info.authKind === 'subscription').map((info) => [info.configDir, info]));
  return accounts.map((account) => {
    const info = confirmed.get(account.id);
    if (info === undefined || account.providerId !== 'codex' || account.apiBilled) return account;
    return { ...account, loginStatus: info.loginStatus };
  });
}
