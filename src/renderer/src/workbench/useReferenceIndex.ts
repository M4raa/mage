import { useEffect, useState } from 'react';
import { useWorkbenchStore } from './workbenchStore';
import { describeError } from './describeError';
import {
  associatedDocumentPaths,
  buildReferenceIndex,
  indexDocumentAnchors,
  planDocuments,
  type DocAnchor,
} from './planReferences';
import type { Block } from './types';

// Indice de referencias de UNA pestana (F5.6, #31): las anclas de sus documentos asociados (los .md
// creados o citados, leidos de disco, y los planes del modo plan, que ya estan en los bloques).
//
// Se relee cuando cambia la lista de rutas o cuando la pestana vuelve a `idle` (fin de turno: el agente
// pudo editar un documento). Durante el streaming no se hace nada: los bloques cambian en cada delta y
// recorrer todos los mensajes por delta seria coste cuadratico.

export type ReferenceIndex = ReadonlyMap<string, readonly DocAnchor[]>;

const EMPTY_BLOCKS: readonly Block[] = [];
const EMPTY_INDEX: ReferenceIndex = new Map();

// Anclas ya indexadas por ruta, validas mientras el `mtimeMs` del fichero no cambie: releer el texto es
// barato, reindexarlo en cada fin de turno de cada pestana no tiene por que serlo.
const anchorCache = new Map<string, { readonly mtimeMs: number | null; readonly anchors: readonly DocAnchor[] }>();

async function anchorsOfFile(cwd: string, path: string): Promise<readonly DocAnchor[]> {
  const file = await window.mage.readProjectFile({ cwd, path });
  if (file.content === null) return [];
  const cached = anchorCache.get(path);
  if (cached !== undefined && cached.mtimeMs === file.mtimeMs) return cached.anchors;
  const anchors = indexDocumentAnchors(path, file.content);
  anchorCache.set(path, { mtimeMs: file.mtimeMs, anchors });
  return anchors;
}

// Lee todos los documentos en paralelo; uno que falla se omite con su aviso (no tumba a los demas).
async function readAnchors(cwd: string, paths: readonly string[]): Promise<readonly DocAnchor[]> {
  const perFile = await Promise.all(
    paths.map((path) =>
      anchorsOfFile(cwd, path).catch((err: unknown) => {
        console.warn(`No se pudo leer ${path} para las referencias del chat:`, describeError(err));
        return [] as readonly DocAnchor[];
      }),
    ),
  );
  return perFile.flat();
}

export function useReferenceIndex(tabId: string): ReferenceIndex {
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY_BLOCKS);
  const cwd = useWorkbenchStore((s) => s.tabs.find((tab) => tab.id === tabId)?.cwd ?? null);
  const status = useWorkbenchStore((s) => s.statusByChat[tabId] ?? 'idle');
  const [built, setBuilt] = useState<{ readonly tabId: string; readonly index: ReferenceIndex } | null>(null);

  useEffect(() => {
    if (status === 'streaming') return;
    let cancelled = false;
    const plans = planDocuments(blocks).flatMap((doc) => indexDocumentAnchors(doc.docId, doc.text));
    const paths = cwd === null ? [] : associatedDocumentPaths(blocks, cwd);
    const filesPromise = cwd === null ? Promise.resolve([] as readonly DocAnchor[]) : readAnchors(cwd, paths);
    void filesPromise.then((files) => {
      if (!cancelled) setBuilt({ tabId, index: buildReferenceIndex([...files, ...plans]) });
    });
    return () => {
      cancelled = true;
    };
  }, [tabId, blocks, cwd, status]);

  return built !== null && built.tabId === tabId ? built.index : EMPTY_INDEX;
}
