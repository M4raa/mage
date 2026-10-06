import { describe, expect, it } from 'vitest';
import { decodeGuiState, encodeGuiState, stopGuiSession } from './guiCheckState.mjs';

describe('guiCheckState', () => {
  it('stop_sesionFicticiaOYaCerrada_limpiezaIdempotente', async () => {
    await expect(stopGuiSession(async () => {
      throw new Error("Error invoking remote method 'session:stop': Error: Sesion inexistente: v39-session");
    }, 'v39-session')).resolves.toBeUndefined();
  });

  it('stop_falloRealOAusenciaDeOtraSesion_noOcultaElError', async () => {
    for (const message of ['IPC desconectado', 'Sesion inexistente: otra-sesion']) {
      const error = new Error(message);
      await expect(stopGuiSession(async () => { throw error; }, 'v39-session')).rejects.toBe(error);
    }
  });

  it('snapshot_estadoConSetsYMaps_conservaTiposYContenidoTrasCDP', () => {
    const state = { draft: { text: 'borrador anterior' }, expanded: new Set(['tab1']), sessions: new Map([['tab1', new Set(['req1'])]]) };

    const restored = decodeGuiState(encodeGuiState(state));

    expect(restored).toEqual(state);
    expect(restored.expanded.has('tab1')).toBe(true);
    expect(restored.sessions.get('tab1').has('req1')).toBe(true);
  });
});
