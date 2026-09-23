import { describe, expect, it } from 'vitest';
import { expiredScratchDirs, type ScratchEntry } from './scratchRetention';

// Esta funcion decide que se BORRA del disco del usuario: los casos que importan son los que evitan
// borrar de mas (politica 'never', carpeta reciente, fecha no fiable).

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function entry(name: string, ageDays: number): ScratchEntry {
  return { name, mtimeMs: NOW - ageDays * DAY };
}

describe('expiredScratchDirs', () => {
  it('expiredScratchDirs_politicaNever_noDevuelveNadaAunqueSeanAntiguas', () => {
    // Arrange
    const entries = [entry('a', 400), entry('b', 1)];

    // Act
    const expired = expiredScratchDirs(entries, 'never', NOW);

    // Assert
    expect(expired).toEqual([]);
  });

  it('expiredScratchDirs_politicaSession_devuelveTodasLasDeEjecucionesAnteriores', () => {
    // Arrange: incognito, asi que hasta la de hace un instante sobra al arrancar.
    const entries = [entry('a', 30), entry('b', 0)];

    // Act
    const expired = expiredScratchDirs(entries, 'session', NOW);

    // Assert
    expect(expired).toEqual(['a', 'b']);
  });

  it('expiredScratchDirs_politica7d_soloLasQuePasanDelPlazo', () => {
    // Arrange
    const entries = [entry('vieja', 8), entry('justa', 7), entry('nueva', 6)];

    // Act
    const expired = expiredScratchDirs(entries, '7d', NOW);

    // Assert: el limite exacto cuenta como cumplido (<=).
    expect(expired).toEqual(['vieja', 'justa']);
  });

  it('expiredScratchDirs_mtimeNoFiable_conservaLaCarpeta', () => {
    // Arrange: un stat que fallo deja NaN; sin fecha fiable no se borra.
    const entries: readonly ScratchEntry[] = [{ name: 'sin-fecha', mtimeMs: Number.NaN }, entry('vieja', 90)];

    // Act
    const expired = expiredScratchDirs(entries, '30d', NOW);

    // Assert
    expect(expired).toEqual(['vieja']);
  });

  it('expiredScratchDirs_sinCarpetas_devuelveVacio', () => {
    // Arrange + Act + Assert
    expect(expiredScratchDirs([], '30d', NOW)).toEqual([]);
  });

  it('expiredScratchDirs_fechaEnElFuturo_noSeBorra', () => {
    // Arrange: un reloj adelantado no puede disparar un borrado.
    const entries = [entry('futura', -5)];

    // Act + Assert
    expect(expiredScratchDirs(entries, '7d', NOW)).toEqual([]);
  });
});
