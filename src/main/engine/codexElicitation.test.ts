import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseElicitationRequest, validateElicitationAnswer, type ElicitationRequest } from '@shared/elicitation';
import { CodexAdapter } from './codexAdapter';
import { ElicitationBroker } from '../runtime/mcp/elicitationBroker';
import type { MageEvent } from '@shared/events';

// Contrato medido con codex-cli 0.160.0 (fixture artificial, 0 turnos reales).
interface Record0 { readonly action: string; readonly request: { readonly id: number; readonly params: unknown }; readonly response: unknown }
const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'spike', '__fixtures__', 'codex-elicitation-0160.json'), 'utf8')) as { records: readonly Record0[] };

const form = (schema: unknown, message = 'm'): unknown => ({ mode: 'form', message, requestedSchema: schema });

describe('parseElicitationRequest', () => {
  it('parseElicitationRequest_objetoPlanoDePrimitivos_loAcepta', () => {
    const request = parseElicitationRequest('r', 's', form({ type: 'object', properties: { n: { type: 'integer' }, p: { type: 'string', format: 'password' } }, required: ['n'] }));
    expect(request?.mode).toBe('form');
  });
  it.each([
    ['anidado', form({ type: 'object', properties: { o: { type: 'object', properties: {} } } })],
    ['array', form({ type: 'object', properties: { a: { type: 'array', items: { type: 'string' } } } })],
    ['required inexistente', form({ type: 'object', properties: {}, required: ['x'] })],
    ['mensaje vacío', form({ type: 'object', properties: {} }, '  ')],
    ['modo desconocido', { mode: 'otro', message: 'm' }],
    ['url http', { mode: 'url', message: 'm', url: 'http://x.test', elicitationId: 'e' }],
    ['no objeto', 'texto'],
  ])('parseElicitationRequest_%s_devuelveNull', (_name, raw) => {
    expect(parseElicitationRequest('r', 's', raw)).toBeNull();
  });
  it('parseElicitationRequest_urlHttps_loAcepta', () => {
    expect(parseElicitationRequest('r', 's', { mode: 'url', message: 'm', url: 'https://x.test/a', elicitationId: 'e' })?.mode).toBe('url');
  });
});

describe('validateElicitationAnswer', () => {
  const request = parseElicitationRequest('r', 's', form({ type: 'object', properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'] })) as ElicitationRequest;
  const base = { sessionId: 'x', requestId: 'r' } as const;
  it('validateElicitationAnswer_contenidoValido_true', () => expect(validateElicitationAnswer(request, { ...base, action: 'accept', content: { n: 2 } })).toBe(true));
  it('validateElicitationAnswer_faltaObligatorioOFueraDeRango_false', () => {
    expect(validateElicitationAnswer(request, { ...base, action: 'accept', content: {} })).toBe(false);
    expect(validateElicitationAnswer(request, { ...base, action: 'accept', content: { n: 0 } })).toBe(false);
    expect(validateElicitationAnswer(request, { ...base, action: 'accept', content: { n: 1.5 } })).toBe(false);
  });
  it('validateElicitationAnswer_campoDesconocidoOContenidoEnDecline_false', () => {
    expect(validateElicitationAnswer(request, { ...base, action: 'accept', content: { n: 2, extra: 'x' } })).toBe(false);
    expect(validateElicitationAnswer(request, { ...base, action: 'decline', content: { n: 2 } })).toBe(false);
  });
});

describe('CodexAdapter: elicitation MCP (0.160.0)', () => {
  for (const record of fixture.records.filter((r) => r.action === 'accept' || r.action === 'decline' || r.action === 'cancel')) {
    it(`encodeElicitationResponse_${record.action}_respondeComoMidioCodex`, () => {
      const adapter = new CodexAdapter({ resolveBinary: () => 'codex' });
      const events = adapter.normalize({ jsonrpc: '2.0', ...record.request });
      const first = events[0];
      if (first?.kind !== 'elicitation_request') throw new Error(`se esperaba elicitation_request y llego ${JSON.stringify(events)}`);
      const content = (record.response as { result: { content: Record<string, string | number | boolean> | null } }).result.content;
      const wire = adapter.encodeElicitationResponse({ sessionId: 's', requestId: first.request.requestId, action: record.action as 'accept', ...(content === null ? {} : { content }) });
      expect(wire).toEqual(record.response);
    });
  }
  it('normalize_esquemaNoSoportado_respondeCancelConAviso', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex' });
    const events = adapter.normalize({ jsonrpc: '2.0', id: 7, method: 'mcpServer/elicitation/request', params: { serverName: 'srv', ...(form({ type: 'object', properties: { a: { type: 'array' } } }) as object) } });
    expect(events[0]?.kind).toBe('notice');
    expect(adapter.takeOutgoing()).toContainEqual({ jsonrpc: '2.0', id: 7, result: { action: 'cancel', content: null } });
  });
});

describe('ElicitationBroker', () => {
  const raw = form({ type: 'object', properties: { n: { type: 'string' } }, required: ['n'] });
  it('request_respuestaAccept_resuelveConContenidoYEmiteResolved', async () => {
    const events: MageEvent[] = [];
    const broker = new ElicitationBroker((e) => events.push(e));
    const result = broker.request('srv', raw);
    const asked = events[0];
    if (asked?.kind !== 'elicitation_request') throw new Error('sin request');
    broker.answer({ sessionId: 's', requestId: asked.request.requestId, action: 'accept', content: { n: 'x' } });
    await expect(result).resolves.toEqual({ action: 'accept', content: { n: 'x' } });
    expect(events[1]).toMatchObject({ kind: 'elicitation_resolved', action: 'accept' });
  });
  it('cancelAll_conPendientes_cancelaTodas', async () => {
    const events: MageEvent[] = [];
    const broker = new ElicitationBroker((e) => events.push(e));
    const result = broker.request('srv', raw);
    broker.cancelAll();
    await expect(result).resolves.toEqual({ action: 'cancel' });
    expect(events.at(-1)?.kind).toBe('elicitation_cancelled');
  });
  it('request_abortSignal_cancela', async () => {
    const controller = new AbortController();
    const broker = new ElicitationBroker(() => undefined);
    const result = broker.request('srv', raw, controller.signal);
    controller.abort();
    await expect(result).resolves.toEqual({ action: 'cancel' });
  });
  it('answer_respuestaInvalida_lanzaYNoResuelve', () => {
    const events: MageEvent[] = [];
    const broker = new ElicitationBroker((e) => events.push(e));
    void broker.request('srv', raw);
    const asked = events[0];
    if (asked?.kind !== 'elicitation_request') throw new Error('sin request');
    expect(() => broker.answer({ sessionId: 's', requestId: asked.request.requestId, action: 'accept', content: {} })).toThrow('inválida');
  });
  it('request_esquemaNoSoportado_cancelaConAviso', async () => {
    const events: MageEvent[] = [];
    const broker = new ElicitationBroker((e) => events.push(e));
    await expect(broker.request('srv', { mode: 'form', message: 'm', requestedSchema: { type: 'array' } })).resolves.toEqual({ action: 'cancel' });
    expect(events[0]?.kind).toBe('notice');
  });
});
