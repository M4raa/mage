import { useRef, useState } from 'react';
import type { MentionPreview } from '@shared/mentions';
import { describeError } from './describeError';
import type { MentionTabContext } from './useMentionSuggestions';

// Vista previa de las fichas (Q06), con cache por `absPath` en un `Map` del componente: cada fichero se
// pide una sola vez (la miniatura al aparecer la ficha, la cabecera de un texto al pasar el raton).

const NO_PREVIEW: MentionPreview = { kind: 'none' };

export interface MentionPreviews {
  get: (absPath: string) => MentionPreview | undefined;
  ensure: (absPath: string) => void;
}

export function useMentionPreviews(tab: MentionTabContext | null): MentionPreviews {
  const cacheRef = useRef(new Map<string, MentionPreview>());
  const pendingRef = useRef(new Set<string>());
  const [, setVersion] = useState(0);
  const cwd = tab?.cwd ?? null;
  const accountDir = tab?.accountDir ?? null;

  const ensure = (absPath: string): void => {
    if (cwd === null || accountDir === null) return;
    if (cacheRef.current.has(absPath) || pendingRef.current.has(absPath)) return;
    pendingRef.current.add(absPath);
    window.mage
      .previewMention({ cwd, accountDir, absPath })
      .then((preview) => cacheRef.current.set(absPath, preview))
      .catch((err: unknown) => {
        console.warn('No se pudo leer la vista previa de la mencion:', describeError(err));
        cacheRef.current.set(absPath, NO_PREVIEW);
      })
      .finally(() => {
        pendingRef.current.delete(absPath);
        setVersion((version) => version + 1);
      });
  };

  return { get: (absPath) => cacheRef.current.get(absPath), ensure };
}
