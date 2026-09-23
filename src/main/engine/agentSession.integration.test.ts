import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import { AgentSession } from './agentSession';
import { ClaudeAdapter } from './claudeAdapter';

// Test de integracion contra el CLI real (consume suscripcion). No corre en `pnpm test` normal;
// solo con MAGE_E2E=1. Verifica el motor de produccion (adapter + session) end-to-end: streaming,
// round-trip de permisos y result, replicando lo que probo el spike M1.0 pero por las clases reales.
const RUN = process.env.MAGE_E2E === '1';

describe('AgentSession (integracion, CLI real)', () => {
  it.skipIf(!RUN)(
    'runOneTurn_withWrite_streamsRequestsPermissionAndResults',
    async () => {
      // Arrange
      const accountDir = process.env.MAGE_ACCOUNT_DIR ?? join(homedir(), '.claude-p');
      const cwd = mkdtempSync(join(tmpdir(), 'mage-e2e-'));
      const events: MageEvent[] = [];
      let session!: AgentSession;

      // Act
      const finished = new Promise<void>((resolve, reject) => {
        session = new AgentSession({
          adapter: new ClaudeAdapter(),
          params: { sessionId: randomUUID(), accountDir, model: 'haiku', cwd },
          emit: (event) => {
            events.push(event);
            if (event.kind === 'permission_request') {
              session.answerPermission(event.request.requestId, { behavior: 'allow' });
            } else if (event.kind === 'result') {
              resolve();
            } else if (event.kind === 'error') {
              reject(new Error(event.message));
            }
          },
        });
        session.start();
        session.sendUserMessage(
          'Usa la herramienta Write para crear el fichero out.txt en el directorio actual ' +
            'con exactamente este contenido: hi',
        );
      });
      await finished;
      session.stop();

      // Assert
      expect(events.some((e) => e.kind === 'stream_delta')).toBe(true);
      expect(events.some((e) => e.kind === 'permission_request')).toBe(true);
      const result = events.find((e) => e.kind === 'result');
      expect(result?.kind === 'result' && result.result.isError).toBe(false);

      // Teardown best-effort: Windows puede retener el cwd del hijo un instante tras matarlo.
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // Dir temporal del SO; se limpiara solo. No es parte de lo que verificamos.
      }
    },
    120_000,
  );

  // Protocolo de control (D2 hooks + D3 contexto) por las clases REALES de produccion, no con una
  // sonda ad-hoc: comprueba que el `initialize` que manda AgentSession registra los hooks, que el
  // hook_callback del CLI se traduce y se contesta (si no se contestara, el turno se bloquearia hasta
  // el timeout), y que al cerrar el turno llega el desglose de contexto.
  it.skipIf(!RUN)(
    'startSession_registersHooksAndReportsContextUsage',
    async () => {
      // Arrange
      const accountDir = process.env.MAGE_ACCOUNT_DIR ?? join(homedir(), '.claude');
      const cwd = mkdtempSync(join(tmpdir(), 'mage-e2e-hooks-'));
      const events: MageEvent[] = [];
      let session!: AgentSession;

      // Act
      const finished = new Promise<void>((resolve, reject) => {
        session = new AgentSession({
          adapter: new ClaudeAdapter(),
          params: { sessionId: randomUUID(), accountDir, model: 'haiku', cwd },
          emit: (event) => {
            events.push(event);
            // El desglose de contexto se pide AL cerrar el turno, asi que llega despues del result.
            if (event.kind === 'context_usage') resolve();
            else if (event.kind === 'error') reject(new Error(event.message));
          },
        });
        session.start();
        session.sendUserMessage('Responde exactamente: ok');
      });
      await finished;
      session.stop();

      // Assert
      const hooks = events.filter((e) => e.kind === 'hook_fired');
      expect(hooks.map((e) => e.kind === 'hook_fired' && e.event)).toContain('UserPromptSubmit');
      expect(hooks.map((e) => e.kind === 'hook_fired' && e.event)).toContain('Stop');
      // El catalogo de comandos con descripcion viene en la respuesta al initialize.
      const commands = events.find((e) => e.kind === 'commands_available');
      expect(commands?.kind === 'commands_available' && commands.commands.length).toBeGreaterThan(0);
      // Y el desglose de contexto, con la ventana EFECTIVA del modelo (no la adivinada por el nombre).
      const usage = events.find((e) => e.kind === 'context_usage');
      if (usage?.kind !== 'context_usage') throw new Error('no llego el desglose de contexto');
      expect(usage.usage.maxTokens).toBeGreaterThan(0);
      expect(usage.usage.totalTokens).toBeGreaterThan(0);
      expect(usage.usage.categories.length).toBeGreaterThan(0);

      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // Dir temporal del SO; se limpiara solo.
      }
    },
    120_000,
  );
});
