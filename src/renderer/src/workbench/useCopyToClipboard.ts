import { useCallback, useEffect, useRef, useState } from 'react';

// Cuanto tiempo se ve «Copiado» antes de volver a «Copiar».
const COPIED_FLASH_MS = 1500;

// Nucleo puro (portapapeles inyectado, testable): devuelve el mensaje de error o null si copio.
export async function copyText(
  clipboard: Pick<Clipboard, 'writeText'>,
  text: string,
): Promise<string | null> {
  try {
    await clipboard.writeText(text);
    return null;
  } catch (err) {
    return `No se pudo copiar: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Hook comun de «Copiar»: estado `copied` temporal y `error` visible (nunca un catch mudo).
export function useCopyToClipboard(): {
  readonly copied: boolean;
  readonly error: string | null;
  readonly copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback((text: string): void => {
    void copyText(navigator.clipboard, text).then((failure) => {
      setError(failure);
      setCopied(failure === null);
      clearTimeout(timer.current);
      if (failure === null) timer.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    });
  }, []);

  return { copied, error, copy };
}
