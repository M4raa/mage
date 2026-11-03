import { useCallback, useEffect, useState } from 'react';
import type { McpRegistrationResult } from '@shared/ipc';

export interface McpRegistrationState {
  readonly result: McpRegistrationResult | null;
  readonly busy: boolean;
  readonly unavailable: boolean;
  readonly register: () => void;
  readonly unregister: () => void;
}

// Estado del registro del servidor MCP de Mage: se lee al montar y cada acción devuelve el estado final.
// Una acción en curso bloquea la siguiente (`busy`); un fallo de IPC deja `unavailable` y se loguea.
export function useMcpRegistration(): McpRegistrationState {
  const [result, setResult] = useState<McpRegistrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const run = useCallback((call: () => Promise<McpRegistrationResult>): void => {
    setBusy(true);
    call()
      .then((next) => { setResult(next); setUnavailable(false); })
      .catch((error: unknown) => {
        console.warn('Registro MCP de Mage: la operación falló', error);
        setUnavailable(true);
      })
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => run(() => window.mage.mcpRegistrationStatus()), [run]);

  return {
    result,
    busy,
    unavailable,
    register: () => run(() => window.mage.registerMageMcp()),
    unregister: () => run(() => window.mage.unregisterMageMcp()),
  };
}
