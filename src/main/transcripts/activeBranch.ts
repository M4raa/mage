// Lector por rama activa (regla A8+). Tras un rewind el .jsonl de Claude conserva la rama descartada;
// la rama activa es la cadena parentUuid desde la hoja, mas lo que cuelga de ella sin ser un mensaje
// (adjuntos, system), los assistant hermanos del mismo message.id y los tool_result puros de sus
// tool_use (llamadas en paralelo). Modulo PURO: sin fs, sin log, sin Date. El corte pendiente (rewind
// aun sin hoja nueva) lo guarda el indice v2 (F4.4) y llega aqui como `pendingCutUuid`.
import type { TranscriptEntry } from '@shared/transcripts';

export interface ActiveBranchState {
  readonly indexByUuid: ReadonlyMap<string, number>; // nodos de la rama -> TranscriptEntry.index
  readonly messageIds: ReadonlySet<string>; // message.id de los assistant de la rama
  readonly toolUseIds: ReadonlySet<string>; // id de los tool_use de los assistant de la rama
  readonly leafIndex: number; // TranscriptEntry.index de la hoja; -1 si no hay
}

export interface ActiveBranchResult {
  readonly entries: readonly TranscriptEntry[];
  readonly state: ActiveBranchState;
}

export interface ActiveBranchOptions {
  readonly pendingCutUuid?: string;
  readonly onMissingParent: (uuid: string) => void;
}

export type BranchExtension =
  | { readonly kind: 'append'; readonly entries: readonly TranscriptEntry[]; readonly state: ActiveBranchState }
  | { readonly kind: 'rebuild' };

type NodeEntry = TranscriptEntry & { readonly uuid: string };

interface MutableBranch {
  readonly indexByUuid: Map<string, number>;
  readonly messageIds: Set<string>;
  readonly toolUseIds: Set<string>;
}

// Candidatos al cierre, indexados para que el cierre sea lineal.
interface CandidateIndexes {
  readonly childrenByParent: Map<string, NodeEntry[]>; // padre -> hijos que NO son mensaje
  readonly assistantsByMessageId: Map<string, NodeEntry[]>;
  readonly pureResultsByToolUseId: Map<string, NodeEntry[]>;
}

// ---------- lectura de entradas ----------

function isNode(entry: TranscriptEntry): entry is NodeEntry {
  return entry.uuid !== null && !entry.isSidechain;
}

function isMessage(entry: TranscriptEntry): boolean {
  return entry.kind === 'user' || entry.kind === 'assistant';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parentOf(entry: TranscriptEntry): string | null {
  if (entry.parentUuid !== null) return entry.parentUuid;
  const logical = asRecord(entry.raw)?.logicalParentUuid;
  return typeof logical === 'string' ? logical : null;
}

function messageIdOf(entry: TranscriptEntry): string | null {
  if (entry.kind !== 'assistant') return null;
  const id = asRecord(asRecord(entry.raw)?.message)?.id;
  return typeof id === 'string' ? id : null;
}

function contentBlocks(entry: TranscriptEntry): readonly unknown[] {
  const content = asRecord(asRecord(entry.raw)?.message)?.content;
  return Array.isArray(content) ? content : [];
}

function toolUseIdsOf(entry: TranscriptEntry): string[] {
  if (entry.kind !== 'assistant') return [];
  const ids: string[] = [];
  for (const block of contentBlocks(entry)) {
    const record = asRecord(block);
    if (record?.type === 'tool_use' && typeof record.id === 'string') ids.push(record.id);
  }
  return ids;
}

function toolResultIdOf(block: unknown): string | null {
  const record = asRecord(block);
  if (record?.type !== 'tool_result') return null;
  return typeof record.tool_use_id === 'string' ? record.tool_use_id : null;
}

// Ids de un user cuyo contenido son SOLO tool_result; null si lleva texto propio u otra cosa.
function pureToolResultIds(entry: TranscriptEntry): string[] | null {
  if (entry.kind !== 'user') return null;
  const blocks = contentBlocks(entry);
  if (blocks.length === 0) return null;
  const ids: string[] = [];
  for (const block of blocks) {
    const id = toolResultIdOf(block);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

// ---------- indices y cierre ----------

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function buildIndexes(nodes: Iterable<NodeEntry>): CandidateIndexes {
  const indexes: CandidateIndexes = {
    childrenByParent: new Map(),
    assistantsByMessageId: new Map(),
    pureResultsByToolUseId: new Map(),
  };
  for (const node of nodes) {
    const parent = parentOf(node);
    if (!isMessage(node) && parent !== null) pushTo(indexes.childrenByParent, parent, node);
    const messageId = messageIdOf(node);
    if (messageId !== null) pushTo(indexes.assistantsByMessageId, messageId, node);
    for (const id of pureToolResultIds(node) ?? []) pushTo(indexes.pureResultsByToolUseId, id, node);
  }
  return indexes;
}

// "Entra" = si no estaba en la rama, se anade y se encola.
function admit(branch: MutableBranch, node: NodeEntry, queue: NodeEntry[]): void {
  if (branch.indexByUuid.has(node.uuid)) return;
  branch.indexByUuid.set(node.uuid, node.index);
  queue.push(node);
}

function admitCompletedResults(branch: MutableBranch, indexes: CandidateIndexes, toolUseId: string, queue: NodeEntry[]): void {
  for (const result of indexes.pureResultsByToolUseId.get(toolUseId) ?? []) {
    const ids = pureToolResultIds(result) ?? [];
    if (ids.every((id) => branch.toolUseIds.has(id))) admit(branch, result, queue);
  }
}

function expandNode(branch: MutableBranch, indexes: CandidateIndexes, node: NodeEntry, queue: NodeEntry[]): void {
  for (const child of indexes.childrenByParent.get(node.uuid) ?? []) admit(branch, child, queue);
  if (node.kind !== 'assistant') return;
  const messageId = messageIdOf(node);
  if (messageId !== null) {
    branch.messageIds.add(messageId);
    for (const sibling of indexes.assistantsByMessageId.get(messageId) ?? []) admit(branch, sibling, queue);
  }
  for (const toolUseId of toolUseIdsOf(node)) {
    branch.toolUseIds.add(toolUseId);
    admitCompletedResults(branch, indexes, toolUseId, queue);
  }
}

// Cierre hasta punto fijo con cola (lineal). Compartido por compute y extend.
function closeBranch(branch: MutableBranch, indexes: CandidateIndexes, queue: NodeEntry[]): void {
  // `for...of` sobre un array que crece durante el recorrido visita tambien lo encolado despues.
  for (const node of queue) expandNode(branch, indexes, node, queue);
}

function selectEntries(entries: readonly TranscriptEntry[], indexByUuid: ReadonlyMap<string, number>): TranscriptEntry[] {
  return entries.filter((entry) => {
    if (entry.isSidechain) return false;
    if (entry.uuid === null) return true; // metadatos (custom-title...): hacen falta para el titulo
    return indexByUuid.get(entry.uuid) === entry.index;
  });
}

function toState(branch: MutableBranch, leafIndex: number): ActiveBranchState {
  return { indexByUuid: branch.indexByUuid, messageIds: branch.messageIds, toolUseIds: branch.toolUseIds, leafIndex };
}

function newBranch(): MutableBranch {
  return { indexByUuid: new Map(), messageIds: new Set(), toolUseIds: new Set() };
}

function latestMessage(nodes: Iterable<NodeEntry>): NodeEntry | null {
  let leaf: NodeEntry | null = null;
  for (const node of nodes) {
    if (isMessage(node) && (leaf === null || node.index > leaf.index)) leaf = node;
  }
  return leaf;
}

// ---------- compute ----------

function indexNodes(entries: readonly TranscriptEntry[]): Map<string, NodeEntry> {
  const nodes = new Map<string, NodeEntry>();
  for (const entry of entries) {
    if (isNode(entry)) nodes.set(entry.uuid, entry);
  }
  return nodes;
}

function findLeaf(nodes: ReadonlyMap<string, NodeEntry>, options: ActiveBranchOptions): { leaf: NodeEntry | null; limit: number } {
  const { pendingCutUuid, onMissingParent } = options;
  if (pendingCutUuid === undefined) return { leaf: latestMessage(nodes.values()), limit: Infinity };
  const target = nodes.get(pendingCutUuid);
  if (target === undefined) throw new Error(`Corte pendiente fuera de la transcripcion: uuid ${pendingCutUuid}`);
  const parent = parentOf(target);
  if (parent === null) return { leaf: null, limit: target.index };
  const leaf = nodes.get(parent);
  if (leaf === undefined || leaf.index >= target.index) {
    onMissingParent(parent);
    return { leaf: null, limit: target.index };
  }
  return { leaf, limit: target.index };
}

// Sube por parentUuid desde la hoja. Un padre ausente o no elegible corta con aviso (no lanza).
function walkPath(
  leaf: NodeEntry,
  nodes: ReadonlyMap<string, NodeEntry>,
  limit: number,
  onMissingParent: (uuid: string) => void,
): NodeEntry[] {
  const path: NodeEntry[] = [];
  const seen = new Set<string>();
  let current: NodeEntry | undefined = leaf;
  while (current !== undefined) {
    if (seen.has(current.uuid)) throw new Error(`Ciclo en la transcripcion: uuid ${current.uuid}`);
    seen.add(current.uuid);
    path.push(current);
    const parent = parentOf(current);
    if (parent === null) break;
    const next = nodes.get(parent);
    if (next === undefined || next.index >= limit) {
      onMissingParent(parent);
      break;
    }
    current = next;
  }
  return path;
}

export function computeActiveBranch(entries: readonly TranscriptEntry[], options: ActiveBranchOptions): ActiveBranchResult {
  const nodes = indexNodes(entries);
  const { leaf, limit } = findLeaf(nodes, options);
  const branch = newBranch();
  const path = leaf === null ? [] : walkPath(leaf, nodes, limit, options.onMissingParent);
  const queue: NodeEntry[] = [];
  for (const node of path) admit(branch, node, queue);
  const eligible = [...nodes.values()].filter((node) => node.index < limit);
  closeBranch(branch, buildIndexes(eligible), queue);
  return { entries: selectEntries(entries, branch.indexByUuid), state: toState(branch, leaf === null ? -1 : leaf.index) };
}

// ---------- extend ----------

// Camino nuevo desde la hoja nueva hasta el primer padre ajeno a `newNodes`; null si hay que reconstruir.
function walkNewPath(state: ActiveBranchState, newNodes: ReadonlyMap<string, NodeEntry>, leaf: NodeEntry): NodeEntry[] | null {
  const path: NodeEntry[] = [];
  const seen = new Set<string>();
  let current = leaf;
  for (;;) {
    if (seen.has(current.uuid)) throw new Error(`Ciclo en la transcripcion: uuid ${current.uuid}`);
    seen.add(current.uuid);
    path.push(current);
    const parent = parentOf(current);
    if (parent === null) return null;
    const next = newNodes.get(parent);
    if (next === undefined) return attachesToBranch(state, parent) ? path : null;
    current = next;
  }
}

// El padre debe estar en la rama anterior y no antes de la hoja (si no, hubo un rewind entre lecturas).
function attachesToBranch(state: ActiveBranchState, parentUuid: string): boolean {
  const parentIndex = state.indexByUuid.get(parentUuid);
  return parentIndex !== undefined && parentIndex >= state.leafIndex;
}

function meetsClosureAgainstBranch(branch: MutableBranch, node: NodeEntry): boolean {
  if (!isMessage(node)) {
    const parent = parentOf(node);
    return parent !== null && branch.indexByUuid.has(parent);
  }
  const messageId = messageIdOf(node);
  if (messageId !== null && branch.messageIds.has(messageId)) return true;
  const ids = pureToolResultIds(node);
  return ids !== null && ids.every((id) => branch.toolUseIds.has(id));
}

export function extendActiveBranch(
  state: ActiveBranchState,
  newEntries: readonly TranscriptEntry[],
  // Se recibe por simetria con compute: aqui un padre desconocido lleva a rebuild, no a aviso.
  _onMissingParent: (uuid: string) => void,
): BranchExtension {
  if (state.leafIndex === -1) return { kind: 'rebuild' };
  const branch: MutableBranch = {
    indexByUuid: new Map(state.indexByUuid),
    messageIds: new Set(state.messageIds),
    toolUseIds: new Set(state.toolUseIds),
  };
  const newNodes = indexNodes(newEntries);
  const newLeaf = latestMessage(newNodes.values());
  const path = newLeaf === null ? [] : walkNewPath(state, newNodes, newLeaf);
  if (path === null) return { kind: 'rebuild' };
  const queue: NodeEntry[] = [];
  for (const node of path) admit(branch, node, queue);
  for (const node of newNodes.values()) {
    if (meetsClosureAgainstBranch(branch, node)) admit(branch, node, queue);
  }
  closeBranch(branch, buildIndexes(newNodes.values()), queue);
  const leafIndex = newLeaf === null ? state.leafIndex : newLeaf.index;
  return { kind: 'append', entries: selectEntries(newEntries, branch.indexByUuid), state: toState(branch, leafIndex) };
}
