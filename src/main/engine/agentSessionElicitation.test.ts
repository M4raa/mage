import { describe, expect, it } from 'vitest';
import type { ElicitationRequest } from '@shared/elicitation';
import { emitLine, fakeAdapter, harness, written } from './agentSession.harness';

const request: ElicitationRequest = {
  requestId: 'e1', server: 'srv', message: 'm', mode: 'form',
  schema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } } },
};

function withElicitation() {
  const base = fakeAdapter();
  const h = harness({ plans: base.plans, adapter: { ...base.adapter, encodeElicitationResponse: (answer) => ({ elicitationAnswer: answer }) } });
  h.session.start();
  emitLine(h.children[0]!, [{ kind: 'elicitation_request', request }]);
  return h;
}

describe('AgentSession elicitation', () => {
  it('answerElicitation_respuestaValida_escribeYEmiteResolved', () => {
    const h = withElicitation();

    h.session.answerElicitation({ sessionId: 's', requestId: 'e1', action: 'accept', content: { n: 'x' } });

    expect(written(h.children[0]!).at(-1)).toMatchObject({ elicitationAnswer: { action: 'accept' } });
    expect(h.events.at(-1)).toEqual({ kind: 'elicitation_resolved', requestId: 'e1', action: 'accept' });
  });

  it('answerElicitation_contenidoInvalido_lanzaYSigueAbierta', () => {
    const h = withElicitation();

    expect(() => h.session.answerElicitation({ sessionId: 's', requestId: 'e1', action: 'accept', content: {} })).toThrow('inválida');
    expect(() => h.session.answerElicitation({ sessionId: 's', requestId: 'e1', action: 'decline' })).not.toThrow();
  });

  it('answerElicitation_desconocida_lanza', () => {
    const h = withElicitation();

    expect(() => h.session.answerElicitation({ sessionId: 's', requestId: 'nope', action: 'cancel' })).toThrow('nope');
  });

  it('exit_conElicitationPendiente_emiteCancelled', () => {
    const h = withElicitation();

    h.children[0]!.emit('exit', 1, null);

    expect(h.events).toContainEqual({ kind: 'elicitation_cancelled', requestId: 'e1' });
  });

  it('stop_conElicitationPendiente_respondeCancelAlCli', () => {
    const h = withElicitation();

    h.session.stop();

    expect(written(h.children[0]!).at(-1)).toMatchObject({ elicitationAnswer: { action: 'cancel' } });
  });
});
