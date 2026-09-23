import { useEffect, useState } from 'react';
import type { SlashCommandInfo } from '@shared/events';
import { useWorkbenchStore } from './workbenchStore';

// Catalogo "/" CACHEADO de la cuenta activa (2.2). Existe porque `ensureSession` es perezoso: en una
// conversacion recien abierta no hay sesion viva de la que sacar los ~159 comandos del usuario, y sin
// esto el popover ofrece los 12 curados — que es el sintoma que motivo el punto.
//
// Es RESPALDO, nunca fuente: en cuanto la sesion reporta su catalogo (`commands_available`), el
// PromptBar usa ese. La cache la ESCRIBE main al ver ese mismo evento, con el config dir EFECTIVO.
//
// Un hook y no un store de zustand: es un dato de solo lectura, por cuenta, que se pide una vez por
// cambio de cuenta. Un store mas seria estado duplicado.
const EMPTY: readonly SlashCommandInfo[] = [];

export function useCachedCommandCatalog(): readonly SlashCommandInfo[] {
  // El config dir EFECTIVO de la pestaña activa (para una conversacion privada, su perfil
  // `mage-private`): es la clave con la que main escribio la cache.
  const accountDir = useWorkbenchStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab === undefined ? s.activeAccountId : (tab.resolvedConfigDir ?? tab.accountId);
  });
  const [catalog, setCatalog] = useState<readonly SlashCommandInfo[]>(EMPTY);

  useEffect(() => {
    if (accountDir.length === 0) {
      setCatalog(EMPTY);
      return;
    }
    let cancelled = false;
    void window.mage
      .loadCommandCatalog(accountDir)
      .then((commands) => {
        if (!cancelled) setCatalog(commands);
      })
      // Sin cache se cae a los comandos curados, que es el comportamiento de siempre: un fallo aqui no
      // puede romper el prompt, pero tampoco se traga en silencio.
      .catch((err: unknown) => console.warn('No se pudo leer el catalogo de comandos cacheado:', err));
    return () => {
      cancelled = true;
    };
  }, [accountDir]);

  return catalog;
}
