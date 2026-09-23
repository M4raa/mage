import { describe, expect, it } from 'vitest';
import { effortChangeAdvice, isLongContext, modelChangeAdvice, modelFamily } from './costAdvice';

describe('modelFamily', () => {
  it('reconoceLasFamiliasDeClaude', () => {
    expect(modelFamily('sonnet')).toBe('sonnet');
    expect(modelFamily('opus[1m]')).toBe('opus');
    expect(modelFamily('HAIKU')).toBe('haiku');
  });

  it('modeloDesconocido_devuelveNull', () => {
    expect(modelFamily('gpt-4o')).toBeNull();
    expect(modelFamily('')).toBeNull();
  });
});

describe('isLongContext', () => {
  it('detectaElSufijo1m', () => {
    expect(isLongContext('sonnet[1m]')).toBe(true);
    expect(isLongContext('sonnet')).toBe(false);
  });
});

describe('modelChangeAdvice', () => {
  it('mismoModelo_devuelveNull', () => {
    expect(modelChangeAdvice('sonnet', 'sonnet')).toBeNull();
    expect(modelChangeAdvice('sonnet', ' sonnet ')).toBeNull();
  });

  it('subirDeFamilia_avisaEnAmbar', () => {
    const advice = modelChangeAdvice('sonnet', 'opus');

    expect(advice?.severity).toBe('warn');
    expect(advice?.message).toContain('Opus');
    expect(advice?.message).toContain('Sonnet');
  });

  it('bajarDeFamilia_soloInforma', () => {
    expect(modelChangeAdvice('opus', 'haiku')?.severity).toBe('info');
  });

  it('mismaFamiliaPeroContexto1M_avisa', () => {
    const advice = modelChangeAdvice('sonnet', 'sonnet[1m]');

    expect(advice?.severity).toBe('warn');
    expect(advice?.message).toContain('1M');
  });

  it('modeloDesconocido_informaSinComparar', () => {
    const advice = modelChangeAdvice('gpt-4o', 'gpt-4o-mini');

    expect(advice?.severity).toBe('info');
    expect(advice?.message).toContain('gpt-4o-mini');
  });
});

describe('effortChangeAdvice', () => {
  it('nivelAlto_avisaEnAmbar', () => {
    expect(effortChangeAdvice('xhigh', false)?.severity).toBe('warn');
    expect(effortChangeAdvice('max', false)?.severity).toBe('warn');
  });

  it('nivelBajo_soloInforma', () => {
    expect(effortChangeAdvice('low', false)?.severity).toBe('info');
  });

  it('vacio_informaDelDefaultDelCli', () => {
    expect(effortChangeAdvice('', false)?.message).toContain('por defecto');
  });

  it('sesionViva_avisaDeQueSeAplicaAlReabrir', () => {
    expect(effortChangeAdvice('high', true)?.message).toContain('reabrir');
    expect(effortChangeAdvice('high', false)?.message).toContain('arrancar');
  });

  it('nivelInvalido_lanzaConElValorRecibido', () => {
    expect(() => effortChangeAdvice('turbo', false)).toThrow(/turbo/);
  });
});
