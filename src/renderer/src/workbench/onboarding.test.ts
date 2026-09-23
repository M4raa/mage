import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, ONBOARDING_VERSION, clampUiScale, UI_SCALE_MAX, UI_SCALE_MIN } from '@shared/settings';
import type { AppSettings } from '@shared/settings';
import { essentialShortcuts, installCommandFor, shouldShowOnboarding, stepAfter, stepBefore } from './onboarding';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ...overrides };
}

describe('onboarding', () => {
  it('shouldShowOnboarding_instalacionLimpia_seEnseña', () => {
    expect(shouldShowOnboarding(settings())).toBe(true);
  });

  it('shouldShowOnboarding_yaCompletado_noVuelveASalir', () => {
    expect(shouldShowOnboarding(settings({ onboardingCompletedVersion: ONBOARDING_VERSION }))).toBe(false);
  });

  // La razon de que el campo sea un numero y no un booleano: subir la version lo vuelve a enseñar una
  // vez a quien ya lo hizo, que es lo que hara falta cuando el asistente gane un paso.
  it('shouldShowOnboarding_completadoConVersionAnterior_vuelveASalir', () => {
    expect(shouldShowOnboarding(settings({ onboardingCompletedVersion: ONBOARDING_VERSION - 1 }))).toBe(true);
  });

  it('stepAfter_ultimoPaso_devuelveNullParaQueElLlamanteCierre', () => {
    expect(stepAfter('engine')).toBe('appearance');
    expect(stepAfter('appearance')).toBe('shortcuts');
    expect(stepAfter('shortcuts')).toBeNull();
  });

  it('stepBefore_primerPaso_devuelveNull', () => {
    expect(stepBefore('engine')).toBeNull();
    expect(stepBefore('shortcuts')).toBe('appearance');
  });

  it('essentialShortcuts_sinOverrides_usaLosDefaultsDelCatalogo', () => {
    const hints = essentialShortcuts([], false);

    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => hint.keys.length > 0 && hint.label.length > 0)).toBe(true);
    expect(hints.find((hint) => hint.actionId === 'conversation.new')?.keys).toBe('Ctrl+N');
  });

  // La chuleta tiene que enseñar lo que de verdad esta cableado: si el usuario recambio el atajo, es el
  // suyo el que sirve.
  it('essentialShortcuts_conOverrideDelUsuario_enseñaElSuyo', () => {
    const hints = essentialShortcuts([{ actionId: 'conversation.new', keys: 'CmdOrCtrl+Shift+K' }], false);

    expect(hints.find((hint) => hint.actionId === 'conversation.new')?.keys).toBe('Ctrl+Shift+K');
  });

  it('essentialShortcuts_overrideIlegible_omiteEsaFilaEnVezDePintarlaAMedias', () => {
    const hints = essentialShortcuts([{ actionId: 'conversation.new', keys: '++' }], false);

    expect(hints.find((hint) => hint.actionId === 'conversation.new')).toBeUndefined();
  });

  it('essentialShortcuts_enMac_usaLosSimbolosDeMac', () => {
    const hints = essentialShortcuts([], true);

    expect(hints.find((hint) => hint.actionId === 'conversation.new')?.keys).toBe('⌘+N');
  });

  it('installCommandFor_proveedorSinComando_devuelveNull', () => {
    expect(installCommandFor('claude')).toContain('@anthropic-ai/claude-code');
    expect(installCommandFor('custom:ollama')).toBeNull();
  });

  it('clampUiScale_fueraDeRangoOBasura_seAcotaAlRangoUtil', () => {
    expect(clampUiScale(500)).toBe(UI_SCALE_MAX);
    expect(clampUiScale(10)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(112.4)).toBe(112);
    expect(clampUiScale(Number.NaN)).toBe(100);
  });
});
