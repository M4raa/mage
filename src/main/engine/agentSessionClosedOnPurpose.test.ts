import { describe, expect, it } from 'vitest';
import { emitLine, harness } from './agentSession.harness';

// Una sesión que Mage cierra a propósito (una subsesión que acabó, o `mage_close_session`) pasa por `stop()`: la política de
// reinicio la trata como salida intencionada y NO la relanza, tampoco con el proceso ya ocioso tras un turno terminado.
describe('AgentSession cerrada a propósito', () => {
  it('stop_trasUnTurnoAcabado_noSeRelanzaAunqueElProcesoMuera', () => {
    const h = harness();
    h.session.start();
    emitLine(h.children[0]!, [{ kind: 'session_init', sessionId: 's1', model: 'sonnet', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] }]);
    emitLine(h.children[0]!, [{ kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } }]);

    h.session.stop();
    h.children[0]!.exit(null, 'SIGTERM');

    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(false);
    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
    expect(h.timers).toHaveLength(0); // ningún reinicio programado
    expect(h.children).toHaveLength(1);
  });
  it('stop_conElProcesoMuriendoConCodigoDeError_tampocoSeRelanza', () => {
    const h = harness();
    h.session.start();
    emitLine(h.children[0]!, [{ kind: 'session_init', sessionId: 's1', model: 'sonnet', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] }]);

    h.session.stop();
    h.children[0]!.exit(1, null);

    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(false);
    expect(h.timers).toHaveLength(0);
    expect(h.children).toHaveLength(1);
  });
});
