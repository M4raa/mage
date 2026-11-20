import { describe, expect, it } from 'vitest';
import { offersResumeOnReset, withResumeOnReset } from './resumeOnResetTab';
import type { Account, Tab } from './types';

const account = (overrides: Partial<Account> = {}): Account => ({ id: '/h/.claude', apiBilled: false, providerId: 'claude', ...overrides }) as Account;
const tab = (overrides: Partial<Tab> = {}): Tab => ({ id: 't1', accountId: '/h/.claude', provider: 'claude', ...overrides }) as Tab;

describe('offersResumeOnReset', () => {
  it('offersResumeOnReset_claudePorSuscripcion_true', () => {
    expect(offersResumeOnReset(tab(), [account()])).toBe(true);
  });
  it('offersResumeOnReset_claudePorApi_false', () => {
    expect(offersResumeOnReset(tab(), [account({ apiBilled: true })])).toBe(false);
  });
  it.each(['codex', 'agy', 'ollama'])('offersResumeOnReset_%s_false', (provider) => {
    expect(offersResumeOnReset(tab({ provider }), [account()])).toBe(false);
  });
  it('offersResumeOnReset_sinPestana_false', () => {
    expect(offersResumeOnReset(undefined, [account()])).toBe(false);
  });
  it('offersResumeOnReset_cuentaAunSinCargar_false', () => {
    expect(offersResumeOnReset(tab(), [])).toBe(false);
  });
  it('offersResumeOnReset_laPestanaEsDeOtraCuenta_usaLaSuya', () => {
    const accounts = [account({ id: '/h/.a', apiBilled: true }), account({ id: '/h/.b' })];
    expect(offersResumeOnReset(tab({ accountId: '/h/.b' }), accounts)).toBe(true);
    expect(offersResumeOnReset(tab({ accountId: '/h/.a' }), accounts)).toBe(false);
  });
});

describe('withResumeOnReset', () => {
  it('withResumeOnReset_encender_poneElCampo', () => {
    expect(withResumeOnReset(tab(), true).resumeOnReset).toBe(true);
  });
  it('withResumeOnReset_apagar_quitaElCampo', () => {
    expect(withResumeOnReset(tab({ resumeOnReset: true }), false)).not.toHaveProperty('resumeOnReset');
  });
  it('withResumeOnReset_noTocaLoDemas', () => {
    expect(withResumeOnReset(tab({ title: 'x', effort: 'low' }), true)).toMatchObject({ id: 't1', title: 'x', effort: 'low' });
  });
});
