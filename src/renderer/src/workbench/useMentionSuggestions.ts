import { useEffect, useMemo, useRef, useState } from 'react';
import type { MentionCandidate } from '@shared/mentions';
import { t as translate } from '../i18n/uiLanguage';
import { touchedFilesOf } from './createdFilesView';
import { describeError } from './describeError';
import { conversationMatches, mentionQueryAt, mentionRows, type MentionRow } from './mentionDraft';
import { useWorkbenchStore } from './workbenchStore';

// Sugerencias de ficheros al escribir `@` (Q06). El hook solo orquesta: la logica pura vive en
// `mentionDraft` y la busqueda en main (`searchMentions`).

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_LIMIT = 20;
const CONVERSATION_LIMIT = 5;

export interface MentionTabContext {
  readonly tabId: string;
  readonly cwd: string;
  readonly accountDir: string;
}

export type MentionSearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'ready'; readonly candidates: readonly MentionCandidate[]; readonly truncated: boolean; readonly untrusted: boolean }
  | { readonly status: 'error'; readonly message: string };

const IDLE: MentionSearchState = { status: 'idle' };
const NO_CANDIDATES: readonly MentionCandidate[] = [];

function searchFailedMessage(err: unknown): string {
  console.warn('No se pudieron buscar ficheros para la mencion:', describeError(err));
  return translate('errors.mentions.searchFailed', { error: describeError(err) });
}

// Busqueda con espera tras la ultima tecla y contador de peticion: una respuesta que ya no es la ultima se
// descarta (si no, una consulta lenta pisaria a la nueva).
function useMentionSearch(tab: MentionTabContext | null, query: string | null): MentionSearchState {
  const [state, setState] = useState<MentionSearchState>(IDLE);
  const requestRef = useRef(0);
  const cwd = tab?.cwd ?? null;
  const accountDir = tab?.accountDir ?? null;
  useEffect(() => {
    requestRef.current += 1;
    const id = requestRef.current;
    if (cwd === null || accountDir === null || query === null) {
      setState(IDLE);
      return;
    }
    const timer = setTimeout(() => {
      window.mage
        .searchMentions({ cwd, accountDir, query, limit: SEARCH_LIMIT })
        .then((result) => {
          if (id === requestRef.current) setState({ status: 'ready', candidates: result.candidates, truncated: result.truncated, untrusted: result.reason === 'untrusted' });
        })
        .catch((err: unknown) => {
          if (id === requestRef.current) setState({ status: 'error', message: searchFailedMessage(err) });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [cwd, accountDir, query]);
  return state;
}

// Ficheros de la conversacion que casan con la consulta. Los bloques se leen del store SOLO al cambiar la
// consulta (no se suscribe: PromptBar se repintaria con cada delta del turno).
function useConversationPaths(tab: MentionTabContext | null, query: string | null): readonly string[] {
  const tabId = tab?.tabId ?? null;
  const cwd = tab?.cwd ?? null;
  return useMemo(() => {
    if (tabId === null || cwd === null || query === null) return [];
    const blocks = useWorkbenchStore.getState().blocksByChat[tabId] ?? [];
    return conversationMatches(touchedFilesOf(blocks), cwd, query, CONVERSATION_LIMIT);
  }, [tabId, cwd, query]);
}

// Clase y tamano de un fichero de la conversacion que el indice no trajo: busqueda por su ruta exacta.
async function lookupCandidate(tab: MentionTabContext, relPath: string): Promise<MentionCandidate | null> {
  const result = await window.mage.searchMentions({ cwd: tab.cwd, accountDir: tab.accountDir, query: relPath, limit: SEARCH_LIMIT });
  const wanted = relPath.toLowerCase();
  return result.candidates.find((candidate) => candidate.relPath.toLowerCase() === wanted) ?? null;
}

export interface MentionSuggestionsContext {
  readonly tab: MentionTabContext | null;
  readonly text: string;
  readonly cursor: number;
  // Con el popover de `/` abierto, o sin poder escribir, no se ofrecen menciones.
  readonly blocked: boolean;
  readonly onPick: (candidate: MentionCandidate) => void;
  readonly onError: (message: string) => void;
}

export interface MentionSuggestions {
  readonly open: boolean;
  readonly rows: readonly MentionRow[];
  readonly index: number;
  readonly state: MentionSearchState;
  readonly loading: boolean;
  setIndex: (index: number) => void;
  pick: (row: MentionRow) => void;
  // Devuelve `true` si la tecla se ha consumido.
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export function useMentionSuggestions(ctx: MentionSuggestionsContext): MentionSuggestions {
  const { tab, text, cursor, blocked, onPick, onError } = ctx;
  const at = useMemo(() => mentionQueryAt(text, cursor), [text, cursor]);
  const queryKey = at === null ? null : `${at.start}:${at.query}`;
  // Escape lo cierra para ESTA consulta; seguir escribiendo (otra consulta) lo reabre, como el de `/`.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const active = at !== null && tab !== null && !blocked;
  const query = active ? at.query : null;
  const state = useMentionSearch(tab, query);
  const conversationPaths = useConversationPaths(tab, query);
  const untrusted = state.status === 'ready' && state.untrusted;
  const candidates = state.status === 'ready' ? state.candidates : NO_CANDIDATES;
  // Carpeta sin confianza: ni siquiera los ficheros de la conversacion (solo el aviso).
  const rows = useMemo(() => (active && !untrusted ? mentionRows(conversationPaths, candidates) : []), [active, untrusted, conversationPaths, candidates]);
  const open = active && dismissedKey !== queryKey;
  useEffect(() => setIndex(0), [queryKey]);
  const current = Math.min(index, Math.max(rows.length - 1, 0));

  const pick = (row: MentionRow): void => {
    if (at === null || tab === null) return;
    if (row.candidate !== null) {
      onPick(row.candidate);
      return;
    }
    lookupCandidate(tab, row.relPath)
      .then((found) => (found === null ? onError(translate('errors.mentions.notFound', { name: row.relPath })) : onPick(found)))
      .catch((err: unknown) => onError(searchFailedMessage(err)));
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open) return false;
    if (event.key === 'Escape') {
      setDismissedKey(queryKey);
      return true;
    }
    const row = rows[current];
    if (row === undefined) return false;
    if (event.key === 'ArrowDown') setIndex((current + 1) % rows.length);
    else if (event.key === 'ArrowUp') setIndex((current - 1 + rows.length) % rows.length);
    else if (event.key === 'Enter' || event.key === 'Tab') pick(row);
    else return false;
    return true;
  };

  return { open, rows, index: current, state, loading: state.status === 'idle', setIndex, pick, onKeyDown };
}
