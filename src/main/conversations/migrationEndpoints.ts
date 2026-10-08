import { join } from 'node:path';
import type { AccountProviderId } from '@shared/accounts';
import { adaptCodexLine } from '@shared/codexTranscript';
import type { NeutralConversation } from '@shared/neutralConversation';
import type { ConversationPrivacy } from '@shared/state';
import { resolveTranscriptPath } from '../transcripts/transcriptPath';
import type { AgyHistoryService } from './agyHistory';
import { agyStepsToLines } from './agyHistory';
import type { AgyDbContent } from './nativeWriters';
import { agyDbContent, claudeTranscriptText, codexRolloutRelativePath, codexRolloutText } from './nativeWriters';
import { neutralFromLines } from './neutralReader';
import type { CodexHistoryService } from './codexHistory';
import type { ConversationRef, ConversationSink, ConversationSource, MigrationEndpoints } from './conversationMigration';

// Los extremos de la migración para cada CLI: cómo leer su conversación (a formato neutral), cómo escribirla en su
// formato nativo y cómo retirarla. Todo el acceso a disco, a SQLite y al CLI de Codex llega inyectado.

export interface MigrationEndpointDeps {
  readonly readText: (path: string) => string;
  readonly writeText: (path: string, text: string) => void; // crea las carpetas que falten
  readonly copyFile: (from: string, to: string) => void; // crea las carpetas que falten
  readonly removeFile: (path: string) => void;
  readonly nowMs: () => number;
  readonly newId: () => string;
  readonly claude: {
    // Dir efectivo de la conversación: la cuenta, o su perfil privado.
    readonly effectiveDir: (accountDir: string, privacy: ConversationPrivacy) => string;
    readonly deleteConversation: (ref: ConversationRef) => void;
  };
  readonly codex: {
    readonly homeOf: (accountDir: string) => string;
    readonly history: Pick<CodexHistoryService, 'findRollout'>;
    readonly deleteThread: (home: string, threadId: string) => Promise<void>;
  };
  readonly agy: {
    // Perfil (USERPROFILE) con el que Mage lanza agy para esa cuenta.
    readonly profileOf: (accountDir: string) => string;
    // Perfil REAL de agy del usuario (solo la suscripción lo tiene): sus conversaciones se leen, pero nunca se borran.
    readonly externalOf?: (accountDir: string) => readonly string[];
    readonly history: Pick<AgyHistoryService, 'findDb' | 'readLines'>;
    readonly writeDb: (dbPath: string, content: AgyDbContent) => void;
  };
}

// `sessions/AAAA/MM/DD/<fichero>`: cinco segmentos desde `sessions`.
const SESSIONS_DEPTH = 5;
const AGY_CONVERSATIONS = ['.gemini', 'antigravity-cli', 'conversations'] as const;

export function createMigrationEndpoints(deps: MigrationEndpointDeps): Readonly<Record<AccountProviderId, MigrationEndpoints>> {
  return { claude: claudeEndpoints(deps), codex: codexEndpoints(deps), agy: agyEndpoints(deps) };
}

function missing(what: string, id: string): never {
  throw new Error(`No existe la conversacion de ${what}: ${id}`);
}

// --- Claude ---------------------------------------------------------------------------------------------------------

function claudeEndpoints(deps: MigrationEndpointDeps): MigrationEndpoints {
  const pathOf = (ref: ConversationRef): string => resolveTranscriptPath(deps.claude.effectiveDir(ref.accountDir, ref.privacy), ref.cwd, ref.sessionId);
  const source: ConversationSource = {
    read: (ref) => {
      const lines = deps.readText(pathOf(ref)).split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as unknown);
      return neutralFromLines(lines, { cwd: ref.cwd, title: '' });
    },
    remove: async (ref) => deps.claude.deleteConversation(ref),
  };
  const sink: ConversationSink = {
    write: (conversation, dest) => {
      const sessionId = deps.newId();
      const configDir = deps.claude.effectiveDir(dest.accountDir, dest.privacy);
      deps.writeText(resolveTranscriptPath(configDir, conversation.cwd, sessionId), claudeTranscriptText(conversation, { sessionId, newId: deps.newId, clock: { baseMs: deps.nowMs() } }));
      return { sessionId, configDir };
    },
    discard: async (ref) => deps.removeFile(resolveTranscriptPath(ref.accountDir, ref.cwd, ref.sessionId)),
  };
  return { source, sink };
}

// --- Codex ----------------------------------------------------------------------------------------------------------

function codexEndpoints(deps: MigrationEndpointDeps): MigrationEndpoints {
  const rolloutOf = (ref: ConversationRef): string => deps.codex.history.findRollout(deps.codex.homeOf(ref.accountDir), ref.sessionId) ?? missing('Codex', ref.sessionId);
  const source: ConversationSource = {
    read: (ref) => {
      const lines = deps.readText(rolloutOf(ref)).split('\n').filter((line) => line.trim().length > 0).map((line) => adaptCodexLine(JSON.parse(line)));
      return neutralFromLines(lines, { cwd: ref.cwd, title: '' });
    },
    remove: (ref) => deps.codex.deleteThread(deps.codex.homeOf(ref.accountDir), ref.sessionId),
  };
  const rolloutPath = (home: string, threadId: string, atMs: number): string => join(home, ...codexRolloutRelativePath(threadId, atMs));
  const sink: ConversationSink = {
    write: (conversation, dest) => {
      const threadId = deps.newId();
      const home = deps.codex.homeOf(dest.accountDir);
      const now = deps.nowMs();
      deps.writeText(rolloutPath(home, threadId, now), codexRolloutText(conversation, { threadId, clock: { baseMs: now } }));
      return { sessionId: threadId, configDir: dest.accountDir };
    },
    // Entre cuentas de Codex el rollout se copia tal cual (medido: otro CODEX_HOME vacío lo reanuda), sin pérdida.
    copyFrom: (ref, dest) => {
      const from = rolloutOf(ref);
      const home = deps.codex.homeOf(dest.accountDir);
      if (deps.codex.history.findRollout(home, ref.sessionId) !== null) throw new Error(`La cuenta de destino ya tiene la conversacion ${ref.sessionId}`);
      deps.copyFile(from, join(home, ...relativeToSessions(from, ref.sessionId)));
      return { sessionId: ref.sessionId, configDir: dest.accountDir };
    },
    discard: async (ref) => deps.removeFile(rolloutOf(ref)),
  };
  return { source, sink };
}

// `sessions/AAAA/MM/DD/<fichero>` de un rollout, a partir de su ruta absoluta (la misma carpeta de fecha en el destino).
function relativeToSessions(rolloutPath: string, threadId: string): string[] {
  const parts = rolloutPath.split(/[\\/]/);
  const at = parts.lastIndexOf('sessions');
  if (at < 0 || parts.length - at !== SESSIONS_DEPTH || !parts[parts.length - 1]!.endsWith(`${threadId}.jsonl`)) throw new Error(`Ruta de rollout inesperada: ${rolloutPath}`);
  return parts.slice(at);
}

// --- agy ------------------------------------------------------------------------------------------------------------

function agyEndpoints(deps: MigrationEndpointDeps): MigrationEndpoints {
  const dbOf = (ref: ConversationRef): string => deps.agy.history.findDb(deps.agy.profileOf(ref.accountDir), ref.sessionId, deps.agy.externalOf?.(ref.accountDir) ?? []) ?? missing('agy', ref.sessionId);
  // Solo se retira lo que es de Mage: la conversación del CLI propio del usuario se queda en su sitio.
  const removeOwned = (ref: ConversationRef): void => {
    const db = dbOf(ref);
    if (!db.startsWith(deps.agy.profileOf(ref.accountDir))) return;
    for (const suffix of ['', '-wal', '-shm']) deps.removeFile(`${db}${suffix}`);
  };
  const source: ConversationSource = {
    read: (ref) => neutralFromLines(deps.agy.history.readLines(dbOf(ref)), { cwd: ref.cwd, title: '' }),
    remove: async (ref) => removeOwned(ref),
  };
  const sink: ConversationSink = {
    write: (conversation: NeutralConversation, dest) => {
      const conversationId = deps.newId();
      const dbPath = join(deps.agy.profileOf(dest.accountDir), ...AGY_CONVERSATIONS, `${conversationId}.db`);
      deps.agy.writeDb(dbPath, agyDbContent(conversation, { conversationId, trajectoryId: deps.newId(), newId: deps.newId, clock: { baseMs: deps.nowMs() } }));
      return { sessionId: conversationId, configDir: dest.accountDir };
    },
    discard: async (ref) => removeOwned(ref),
  };
  return { source, sink };
}

