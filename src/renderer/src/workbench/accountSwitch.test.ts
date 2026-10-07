import { describe, expect, it } from 'vitest';
import { modelForReassignedTab, planAccountSwitch, type AccountSwitchContext } from './accountSwitch';

const A = 'C:/Users/u/.claude';
const B = 'C:/Users/u/.claude-p';

function ctx(over: Partial<AccountSwitchContext> = {}): AccountSwitchContext {
  return {
    activeTab: { accountId: A, resumeSessionId: 's1' },
    status: 'idle',
    liveSessionId: undefined,
    destAccountId: B,
    destLoggedIn: true,
    hasBlocks: false,
    canMigrate: true,
    ...over,
  };
}

describe('planAccountSwitch', () => {
  it('planAccountSwitch_sinPestana_switch', () => {
    expect(planAccountSwitch(ctx({ activeTab: undefined }))).toBe('switch');
  });

  it('planAccountSwitch_mismaCuenta_switch', () => {
    expect(planAccountSwitch(ctx({ destAccountId: A }))).toBe('switch');
  });

  it('planAccountSwitch_destinoSinLogin_switch', () => {
    expect(planAccountSwitch(ctx({ destLoggedIn: false, status: 'streaming' }))).toBe('switch');
  });

  it('planAccountSwitch_turnoEnMarcha_switchAndNewChat', () => {
    expect(planAccountSwitch(ctx({ status: 'streaming', liveSessionId: 'live' }))).toBe('switch-and-new-chat');
    expect(planAccountSwitch(ctx({ status: 'needs_permission', liveSessionId: 'live' }))).toBe('switch-and-new-chat');
  });

  it('planAccountSwitch_cuentasDeOtroProveedor_noMigraAbreChatNuevo', () => {
    expect(planAccountSwitch(ctx({ canMigrate: false }))).toBe('switch-and-new-chat');
  });

  it('planAccountSwitch_pestanaParadaDeOtraCuenta_ask', () => {
    // Restaurada: solo `resumeSessionId`, sin sesion viva (el caso que `continueInAccount` ignoraba).
    expect(planAccountSwitch(ctx())).toBe('ask');
    expect(planAccountSwitch(ctx({ activeTab: { accountId: A }, liveSessionId: 'live' }))).toBe('ask');
  });

  it('planAccountSwitch_chatNuevoSinBloques_reassign', () => {
    expect(planAccountSwitch(ctx({ activeTab: { accountId: A } }))).toBe('reassign');
  });

  it('planAccountSwitch_conBloquesSinSesion_switch', () => {
    expect(planAccountSwitch(ctx({ activeTab: { accountId: A }, hasBlocks: true }))).toBe('switch');
  });

  it('planAccountSwitch_chatNuevoDestinoSinLogin_switch', () => {
    expect(planAccountSwitch(ctx({ activeTab: { accountId: A }, destLoggedIn: false }))).toBe('switch');
  });

  it('planAccountSwitch_pestanaConError_ask', () => {
    // Un turno que fallo ya no esta en marcha: la conversacion se puede llevar.
    expect(planAccountSwitch(ctx({ status: 'error' }))).toBe('ask');
  });
});

describe('modelForReassignedTab', () => {
  it('modelForReassignedTab_estaEnElCatalogoDestino_seConserva', () => {
    expect(modelForReassignedTab('opus', ['sonnet', 'opus'], () => 'sonnet')).toBe('opus');
  });

  it('modelForReassignedTab_noEstaEnElCatalogo_seReResuelve', () => {
    expect(modelForReassignedTab('claude-fable-5-1', ['sonnet', 'opus'], () => 'sonnet')).toBe('sonnet');
  });

  it('modelForReassignedTab_catalogoDesconocido_seConserva', () => {
    expect(modelForReassignedTab('opus', undefined, () => 'sonnet')).toBe('opus');
  });

  it('modelForReassignedTab_catalogoVacio_seReResuelve', () => {
    expect(modelForReassignedTab('opus', [], () => 'sonnet')).toBe('sonnet');
  });
});
