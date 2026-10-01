import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import { AgentSession } from './agentSession';
import { AgyAdapter } from './agyAdapter';

// Integracion contra el CLI REAL de agy (consume suscripcion: 3 turnos cortos con el modelo mas barato).
// No corre en `pnpm test`; solo con MAGE_E2E_AGY=1. Recorre el motor de produccion (AgyAdapter +
// AgentSession) en sesion persistente: un turno, interrumpir otro a mitad (corte del arbol) y un
// tercero que relanza con `--conversation` y conserva el contexto; con una imagen adjunta por ruta.
const RUN = process.env.MAGE_E2E_AGY === '1';
const MODEL = 'gemini-3.8-flash-low';
const TURN_TIMEOUT_MS = 180_000;
// PNG de 1x1 rojo.
const RED_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

// Medido: agy deja un proceso suyo con la carpeta abierta un rato despues de morir la sesion (EPERM al
// borrarla). Es del temporal del SO: si no se puede borrar ya, se avisa y se deja.
function removeLater(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (err) {
    console.warn(`No se pudo borrar ${dir} todavia (${err instanceof Error ? err.message : String(err)}): queda en el temporal`);
  }
}

describe('AgentSession + AgyAdapter (integracion, agy real)', () => {
  it.skipIf(!RUN)(
    'sesionPersistente_turnoCorteYReanudacion_conservaElContexto',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'mage-agy-e2e-'));
      const events: MageEvent[] = [];
      let waiter: { count: number; resolve: () => void } | null = null;
      const results = (): number => events.filter((e) => e.kind === 'result').length;
      const waitResults = (count: number): Promise<void> =>
        new Promise((resolve) => {
          if (results() >= count) resolve();
          else waiter = { count, resolve };
        });
      const session = new AgentSession({
        adapter: new AgyAdapter({
          saveAttachment: (_s, attachment) => {
            const path = join(cwd, '..', `mage-agy-e2e-${Date.now()}.png`);
            writeFileSync(path, Buffer.from(attachment.data, 'base64'));
            return path;
          },
        }),
        params: { sessionId: 'e2e', accountDir: '', model: MODEL, cwd },
        emit: (event) => {
          events.push(event);
          if (waiter !== null && results() >= waiter.count) waiter.resolve();
        },
      });
      try {
        session.start();
        session.sendUserMessage('Remember the word PLUM. Reply with exactly: OK');
        await waitResults(1);
        session.sendUserMessage('Count from 1 to 300, one number per line, no other text.');
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        session.interrupt();
        await waitResults(2);
        session.sendUserMessage('What word did I ask you to remember, and what color is [Imagen 1]? Two words.', [{ mediaType: 'image/png', data: RED_PIXEL_PNG }]);
        await waitResults(3);

        const text = events.flatMap((e) => (e.kind === 'stream_delta' ? [e.text] : [])).join('');
        const interrupted = events.filter((e) => e.kind === 'result')[1];
        expect(interrupted).toMatchObject({ result: { subtype: 'interrupted' } });
        expect(text.toUpperCase()).toContain('PLUM');
        expect(text.toLowerCase()).toContain('red');
        expect(events.filter((e) => e.kind === 'session_init').length).toBe(2); // dos procesos, la misma conversacion
      } finally {
        session.stop();
        removeLater(cwd);
      }
    },
    TURN_TIMEOUT_MS * 3,
  );
});
