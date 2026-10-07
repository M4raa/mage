import { randomUUID } from 'node:crypto';
import type { MageEvent } from '@shared/events';
import { parseElicitationRequest, validateElicitationAnswer, type ElicitationAnswer, type ElicitationRequest } from '@shared/elicitation';

export type McpElicitationResult = { readonly action: 'accept' | 'decline' | 'cancel'; readonly content?: Readonly<Record<string, string | number | boolean>> };

export class ElicitationBroker {
  private readonly pending = new Map<string, { readonly request: ElicitationRequest; readonly resolve: (result: McpElicitationResult) => void }>();

  constructor(private readonly emit: (event: MageEvent) => void) {}

  request(server: string, raw: unknown, signal?: AbortSignal): Promise<McpElicitationResult> {
    const requestId = `mcp-${randomUUID()}`;
    const request = parseElicitationRequest(requestId, server, raw);
    if (request === null) {
      this.emit({ kind: 'notice', text: `El servidor ${server} pidió un formulario MCP que Mage no puede mostrar; se canceló.` });
      return Promise.resolve({ action: 'cancel' });
    }
    if (signal?.aborted) return Promise.resolve({ action: 'cancel' });
    return new Promise((resolve) => {
      this.pending.set(requestId, { request, resolve });
      signal?.addEventListener('abort', () => this.cancel(requestId), { once: true });
      this.emit({ kind: 'elicitation_request', request });
    });
  }

  answer(answer: ElicitationAnswer): void {
    const pending = this.pending.get(answer.requestId);
    if (pending === undefined) throw new Error(`Elicitation desconocida o resuelta: ${answer.requestId}`);
    if (!validateElicitationAnswer(pending.request, answer)) throw new Error('Respuesta de elicitation inválida');
    this.pending.delete(answer.requestId);
    pending.resolve({ action: answer.action, ...(answer.action === 'accept' && pending.request.mode === 'form' ? { content: answer.content ?? {} } : {}) });
    this.emit({ kind: 'elicitation_resolved', requestId: answer.requestId, action: answer.action });
  }

  cancelAll(): void {
    for (const requestId of this.pending.keys()) this.cancel(requestId);
  }

  private cancel(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    pending.resolve({ action: 'cancel' });
    this.emit({ kind: 'elicitation_cancelled', requestId });
  }
}
