import type { Account } from '../types';

// Insignia de login de una cuenta, compartida por sus DOS representaciones: el avatar compacto de la
// cabecera (`AccountSwitcher`) y el que pinta el rail. Vivia dentro de `AccountRail`; se saca aqui al
// mover el selector a la cabecera, para que no acaben divergiendo los colores del punto — que es lo
// unico que distingue "sin login" de "login expirado" de un vistazo.

export function loginDot(account: Account): { className: string; style?: React.CSSProperties } {
  if (account.loginStatus === 'logged_in') return { className: 'bg-mg-idle' };
  if (account.loginStatus === 'expired') return { className: '', style: { background: 'var(--mg-warn)' } };
  return { className: '', style: { background: 'var(--color-mg-danger-emph)' } };
}

export function loginLabel(account: Account): string {
  if (account.loginStatus === 'logged_in') return 'con login';
  if (account.loginStatus === 'expired') return 'login expirado';
  return 'sin login';
}
