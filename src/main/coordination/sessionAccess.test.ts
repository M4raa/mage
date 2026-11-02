import { describe, expect, it } from 'vitest';
import { canControlSession } from './sessionAccess';

const MAIN = 1;
const deps = (owner: number | null | undefined) => ({ ownerOf: () => owner, isMainWindow: (id: number) => id === MAIN });

describe('canControlSession', () => {
  it('canControlSession_elDueno_true', () => {
    expect(canControlSession(deps(7), 7, 's')).toBe(true);
  });

  it('canControlSession_otraVentanaSecundaria_false', () => {
    expect(canControlSession(deps(7), 8, 's')).toBe(false);
  });

  it('canControlSession_laVentanaPrincipal_trueAunqueNoSeaLaDuena', () => {
    expect(canControlSession(deps(7), MAIN, 's')).toBe(true);
  });

  it('canControlSession_sesionSinDueno_soloLaPrincipal', () => {
    expect(canControlSession(deps(null), 8, 's')).toBe(false);
    expect(canControlSession(deps(null), MAIN, 's')).toBe(true);
  });

  it('canControlSession_sesionQueNoSeSigue_trueParaQueElCoordinadorDigaInexistente', () => {
    expect(canControlSession(deps(undefined), 8, 's')).toBe(true);
  });
});
