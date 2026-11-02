import { runsOnMageRuntime } from '@shared/providers';
import type { Tab } from './types';
import { t } from '../i18n/uiLanguage';

// «Omitir permisos» (#1): el aviso es de la ACTIVACION del modo, no de la visita. Antes lo emitia un
// efecto de PromptBar en cada montaje con el modo activo (cambiar de chat y volver, reabrir, reiniciar),
// asi que se repetia. Ahora se compara el estado anterior y el nuevo de cada pestaña: solo avisa la que
// ya existia y pasa de otro modo a `bypassPermissions`. Una pestaña nueva o restaurada que ya viene en
// ese modo no avisa; desactivar y reactivar es una activacion nueva.

export const BYPASS_PERMISSIONS_MODE = 'bypassPermissions';

// Sin prometer nada fuera del proyecto: el runtime propio pregunta por las rutas que VE fuera, pero es una
// heuristica de texto, no una frontera (permissionGate.ts), y Claude con este modo no pregunta nada.
export function bypassPermissionsAdvice(): string {
  return t('prompt.bypass.advice');
}

// Pestañas que acaban de activar «Omitir permisos». O(n) con un Map de las anteriores.
export function bypassActivatedTabs(previous: readonly Tab[], next: readonly Tab[]): Tab[] {
  if (previous === next) return [];
  const before = new Map(previous.map((tab) => [tab.id, tab]));
  return next.filter((tab) => {
    const old = before.get(tab.id);
    if (old === undefined || !offersBypass(tab.provider)) return false;
    return tab.permissionMode === BYPASS_PERMISSIONS_MODE && old.permissionMode !== BYPASS_PERMISSIONS_MODE;
  });
}

// Los proveedores en los que Mage enseña ese aviso: Claude y el runtime propio (agy y Codex tienen el suyo).
function offersBypass(provider: string): boolean {
  return provider === 'claude' || runsOnMageRuntime(provider);
}
