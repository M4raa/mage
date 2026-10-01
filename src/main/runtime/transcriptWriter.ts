import { dirname } from 'node:path';
import { resolveTranscriptPath } from '../transcripts/transcriptPath';
import type { SessionLogFn } from '../engine/agentSession';
import type { LoopEvent, TurnOutcome } from './agentLoop';
import type { ChatMessage } from './chatClient';
import type { TurnRecorder } from './runtimeSession';

// Escribe la conversacion del runtime propio en el MISMO JSONL que el CLI de Claude
// (`transcripts/schemas.ts`): asi el historial, los titulos, `transcriptToBlocks` y el Inspector
// funcionan sin cambios. Vive en `userData/runtime/projects/<cwd>/<id>.jsonl` (ficha D3): de Mage, fuera
// del `projects/` de las cuentas de Claude y de sus junctions.
//
// Una linea por mensaje del usuario, una `assistant` por vuelta del modelo (texto, pensamiento y
// tool_use) y una `user` con UN `tool_result` por llamada (como el CLI), con `toolUseResult` para que
// el diff de Write/Edit se pinte al reabrir.

export interface TranscriptWriterDeps {
  readonly root: string; // userData/runtime
  readonly cwd: string;
  readonly model: () => string;
  readonly mkdir: (path: string) => void;
  readonly appendLine: (path: string, line: string) => void;
  readonly now: () => number;
  readonly newId: () => string;
  readonly log?: SessionLogFn;
}

interface RoundBuffer {
  thinking: string;
  text: string;
  toolUses: Array<{ type: 'tool_use'; id: string; name: string; input: Readonly<Record<string, unknown>> }>;
}

export class TranscriptWriter implements TurnRecorder {
  private sessionId: string;
  private parentUuid: string | null = null;
  private round: RoundBuffer = emptyRound();
  private failed = false;

  constructor(
    sessionId: string,
    private readonly deps: TranscriptWriterDeps,
    // Al reanudar se encadena tras la ultima linea existente.
    lastUuid: string | null = null,
  ) {
    this.sessionId = sessionId;
    this.parentUuid = lastUuid;
  }

  get path(): string {
    return resolveTranscriptPath(this.deps.root, this.deps.cwd, this.sessionId);
  }

  user(text: string): void {
    this.write({ type: 'user', message: { role: 'user', content: text } });
  }

  loop(event: LoopEvent): void {
    switch (event.kind) {
      case 'text_delta':
        this.round.text += event.text;
        return;
      case 'thinking_delta':
        this.round.thinking += event.text;
        return;
      case 'tool_use':
        this.round.toolUses.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
        return;
      case 'round_done':
        this.flushRound(event.usage);
        return;
      case 'tool_result':
        this.write({
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: event.id, content: event.output, is_error: event.isError }] },
          ...(event.file === undefined
            ? {}
            : { toolUseResult: { filePath: event.file.path, content: event.file.content, structuredPatch: event.file.structuredPatch } }),
        });
        return;
      default:
        return;
    }
  }

  // Lo que quedo a medias de una vuelta (un turno que fallo con texto ya recibido).
  turnEnd(_added: readonly ChatMessage[], _outcome: TurnOutcome): void {
    if (this.round.text.length > 0 || this.round.toolUses.length > 0) this.flushRound(null);
  }

  reset(newSessionId: string): void {
    this.sessionId = newSessionId;
    this.parentUuid = null;
    this.round = emptyRound();
  }

  rename(title: string): void {
    this.write({ type: 'custom-title', customTitle: title });
  }

  private flushRound(usage: { inputTokens: number; outputTokens: number } | null): void {
    const { thinking, text, toolUses } = this.round;
    this.round = emptyRound();
    const content = [
      ...(thinking.length === 0 ? [] : [{ type: 'thinking', thinking }]),
      ...(text.length === 0 ? [] : [{ type: 'text', text }]),
      ...toolUses,
    ];
    if (content.length === 0) return;
    this.write({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: this.deps.model(),
        content,
        ...(usage === null ? {} : { usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } }),
      },
    });
  }

  private write(line: Record<string, unknown>): void {
    const uuid = this.deps.newId();
    const record = {
      ...line,
      uuid,
      parentUuid: this.parentUuid,
      isSidechain: false,
      timestamp: new Date(this.deps.now()).toISOString(),
      sessionId: this.sessionId,
      cwd: this.deps.cwd,
    };
    try {
      const path = this.path;
      this.deps.mkdir(dirname(path));
      this.deps.appendLine(path, `${JSON.stringify(record)}\n`);
      this.parentUuid = uuid;
    } catch (err) {
      // La conversacion sigue aunque el disco falle; se avisa UNA vez por sesion en el log.
      if (!this.failed) this.deps.log?.('error', 'No se pudo escribir la transcripcion del runtime', { error: (err as Error).message });
      this.failed = true;
    }
  }
}

function emptyRound(): RoundBuffer {
  return { thinking: '', text: '', toolUses: [] };
}
