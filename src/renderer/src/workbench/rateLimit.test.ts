import { describe, expect, it } from 'vitest';
import type { UsageInfo } from '@shared/usage';
import {
  AUTO_CONTINUE_MARGIN_MS,
  autoContinueBlockedReason,
  effectiveResetMs,
  mergeRateLimitNotice,
  rateLimitLineText,
  shouldAutoContinue,
} from './rateLimit';

const NOW = new Date(2026, 8, 29, 12, 0).getTime();
const H = 60 * 60 * 1000;

function usage(fiveHourPct: number, resetsAt: number | null): UsageInfo {
  return {
    fiveHour: { utilization: fiveHourPct, resetsAt },
    sevenDay: { utilization: 10, resetsAt: null },
    limits: [],
    apiCreditsMinor: null,
    fetchedAt: NOW,
  };
}

describe('rateLimitLineText', () => {
  it('rateLimitLineText_sinHora_textoGenerico', () => {
    expect(rateLimitLineText(null)).toBe('Límite de uso alcanzado');
  });

  it('rateLimitLineText_conHora_diceCuando', () => {
    expect(rateLimitLineText(NOW + H)).toMatch(/^Límite de uso alcanzado · se restablece a las /);
  });
});

describe('mergeRateLimitNotice', () => {
  it('mergeRateLimitNotice_sinPrevio_normalizaElTexto', () => {
    expect(mergeRateLimitNotice(undefined, { summary: '  hola  ', resetsAtMs: null })).toEqual({ summary: 'hola', resetsAtMs: null });
  });

  it('mergeRateLimitNotice_segundoSinHora_conservaLaHoraDelPrimero', () => {
    const merged = mergeRateLimitNotice({ summary: '', resetsAtMs: 5 }, { summary: 'texto del CLI', resetsAtMs: null });

    expect(merged).toEqual({ summary: 'texto del CLI', resetsAtMs: 5 });
  });

  it('mergeRateLimitNotice_segundoSinTexto_conservaElTextoYElOptIn', () => {
    const merged = mergeRateLimitNotice({ summary: 'texto', resetsAtMs: null, autoContinue: true }, { summary: ' ', resetsAtMs: 9 });

    expect(merged).toEqual({ summary: 'texto', resetsAtMs: 9, autoContinue: true });
  });
});

describe('effectiveResetMs', () => {
  it('effectiveResetMs_avisoConHora_usaLaDelAviso', () => {
    expect(effectiveResetMs({ summary: '', resetsAtMs: 7 }, usage(100, 99))).toBe(7);
  });

  it('effectiveResetMs_avisoSinHoraYVentanaAgotada_usaLaDeLaVentana', () => {
    expect(effectiveResetMs({ summary: '', resetsAtMs: null }, usage(100, 99))).toBe(99);
  });

  it('effectiveResetMs_ventanaNoAgotada_null', () => {
    expect(effectiveResetMs({ summary: '', resetsAtMs: null }, usage(80, 99))).toBeNull();
    expect(effectiveResetMs({ summary: '', resetsAtMs: null }, null)).toBeNull();
  });
});

describe('autoContinueBlockedReason', () => {
  it('autoContinueBlockedReason_sinHora_motivo', () => {
    expect(autoContinueBlockedReason(null, NOW)).toMatch(/Sin hora/);
  });

  it('autoContinueBlockedReason_semanal_motivo', () => {
    expect(autoContinueBlockedReason(NOW + 6 * H, NOW)).toMatch(/5 horas/);
  });

  it('autoContinueBlockedReason_cincoHoras_null', () => {
    expect(autoContinueBlockedReason(NOW + 2 * H, NOW)).toBeNull();
    expect(autoContinueBlockedReason(NOW - H, NOW)).toBeNull();
  });
});

describe('shouldAutoContinue', () => {
  const reset = NOW - AUTO_CONTINUE_MARGIN_MS;
  const base = { now: NOW, notice: { summary: '', resetsAtMs: reset, autoContinue: true }, status: 'idle' as const, resetsAtMs: reset };

  it('shouldAutoContinue_activadoParadaYResetPasadoConMargen_true', () => {
    expect(shouldAutoContinue(base)).toBe(true);
  });

  it('shouldAutoContinue_dentroDelMargen_false', () => {
    expect(shouldAutoContinue({ ...base, now: reset + AUTO_CONTINUE_MARGIN_MS - 1 })).toBe(false);
  });

  it('shouldAutoContinue_noActivado_false', () => {
    expect(shouldAutoContinue({ ...base, notice: { summary: '', resetsAtMs: reset } })).toBe(false);
    expect(shouldAutoContinue({ ...base, notice: undefined })).toBe(false);
  });

  it('shouldAutoContinue_pestanaTrabajando_false', () => {
    expect(shouldAutoContinue({ ...base, status: 'streaming' })).toBe(false);
    expect(shouldAutoContinue({ ...base, status: 'needs_permission' })).toBe(false);
  });

  it('shouldAutoContinue_sinHora_false', () => {
    expect(shouldAutoContinue({ ...base, resetsAtMs: null })).toBe(false);
  });

  it('shouldAutoContinue_limiteSemanal_false', () => {
    expect(shouldAutoContinue({ ...base, resetsAtMs: NOW + 6 * H })).toBe(false);
  });
});
