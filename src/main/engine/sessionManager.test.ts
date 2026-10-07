import { describe, expect, it, vi } from 'vitest';
import type { MageEvent } from '@shared/events';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import { SessionManager, type ManagedSession } from './sessionManager';
import type { AgentSessionDeps } from './agentSession';
import type { LaunchParams, ProviderAdapter } from './providerAdapter';
import type { DefaultsDeps } from './sessionDefaults';

const HOME = '/home/u';

// Defaults con "login" en todas las cuentas: lo que se prueba aqui es el manager, no la resolucion de
// cuenta por defecto (eso ya lo cubre sessionDefaults.test.ts).
function defaults(): DefaultsDeps {
  return { homedir: HOME, fileExists: () => true, listHome: () => ['.claude'], resolveShared: () => ({ mcpServers: [], settingsFragment: null, claudeAiConnectors: true }) };
}

function params(overrides: Partial<CreateSessionParams> = {}): CreateSessionParams {
  return {
    accountDir: `${HOME}/.claude`,
    model: 'sonnet',
    provider: 'claude',
    cwd: '/proj',
    privacy: 'shared',
    ...overrides,
  } as CreateSessionParams;
}

interface Harness {
  readonly manager: SessionManager;
  readonly created: Array<{ deps: AgentSessionDeps; session: ManagedSession }>;
  readonly payloads: SessionEventPayload[];
  readonly providers: string[];
  readonly sink: (payload: SessionEventPayload) => void;
  launchOf: (index: number) => LaunchParams;
}

function harness(): Harness {
  const created: Array<{ deps: AgentSessionDeps; session: ManagedSession }> = [];
  const payloads: SessionEventPayload[] = [];
  const providers: string[] = [];

  const manager = new SessionManager((provider, base) => {
    providers.push(provider);
    const deps = { ...base, adapter: {} as ProviderAdapter } as AgentSessionDeps;
    const session: ManagedSession = {
      start: vi.fn(),
      sendUserMessage: vi.fn(),
      answerPermission: vi.fn(),
      interrupt: vi.fn(),
      setModel: vi.fn(),
      setPermissionMode: vi.fn(),
      stopTask: vi.fn(),
      stop: vi.fn(),
    };
    created.push({ deps, session });
    return session;
  }, defaults());

  return {
    manager,
    created,
    payloads,
    providers,
    sink: (payload) => payloads.push(payload),
    launchOf: (index) => {
      const entry = created[index];
      if (entry === undefined) throw new Error(`no se creo la sesion ${index}`);
      return entry.deps.params;
    },
  };
}

describe('SessionManager.create', () => {
  it('create_sinResumeSessionId_generaUnIdNuevoYNoMarcaResume', () => {
    const h = harness();

    const sessionId = h.manager.create(params(), h.sink);

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.launchOf(0)).toMatchObject({ sessionId, resume: false });
  });

  it('create_claudeConResumeSessionId_reutilizaEseIdYMarcaResume', () => {
    // M2.5: reanudar es la MISMA transcripcion, asi que el id no puede cambiar.
    const h = harness();

    const sessionId = h.manager.create(params({ resumeSessionId: 'previa-123' }), h.sink);

    expect(sessionId).toBe('previa-123');
    expect(h.launchOf(0)).toMatchObject({ sessionId: 'previa-123', resume: true });
  });

  it('create_agyConResumeSessionId_sesionNuevaYReanudaSuConversacion', () => {
    // agy lleva su historial en su propio formato: el id es el suyo (`--conversation`) y la sesion de Mage es nueva.
    const h = harness();

    const sessionId = h.manager.create(params({ provider: 'agy', resumeSessionId: 'previa-123' }), h.sink);

    expect(sessionId).not.toBe('previa-123');
    expect(h.launchOf(0)).toMatchObject({ resume: false, conversationId: 'previa-123' });
  });

  it('create_codexConResumeSessionId_sesionNuevaYReanudaSuHilo', () => {
    // Codex lleva su propia conversacion: el id es el de su hilo, y Mage abre una sesion nueva sobre el.
    const h = harness();

    const sessionId = h.manager.create(params({ provider: 'codex', resumeSessionId: 'hilo-123' }), h.sink);

    expect(sessionId).not.toBe('hilo-123');
    expect(h.launchOf(0)).toMatchObject({ resume: false, conversationId: 'hilo-123' });
  });

  it('create_runtimePropioConResumeSessionId_reanudaConElMismoId', () => {
    // P-032 R4: el runtime propio relee su transcripcion de userData/runtime.
    const h = harness();

    const sessionId = h.manager.create(params({ provider: 'custom:ollama', accountDir: '', resumeSessionId: 'previa-123' }), h.sink);

    expect(sessionId).toBe('previa-123');
    expect(h.launchOf(0).resume).toBe(true);
  });

  it('create_resumeSessionIdVacio_seTrataComoAusente', () => {
    const h = harness();

    const sessionId = h.manager.create(params({ resumeSessionId: '' }), h.sink);

    expect(sessionId).not.toBe('');
    expect(h.launchOf(0).resume).toBe(false);
  });

  it('create_arrancaLaSesion', () => {
    const h = harness();

    h.manager.create(params(), h.sink);

    expect(h.created[0]?.session.start).toHaveBeenCalledTimes(1);
  });

  it('create_pideElAdapterDelProveedorPedido', () => {
    const h = harness();

    h.manager.create(params({ provider: 'ollama' }), h.sink);

    expect(h.providers).toEqual(['ollama']);
  });

  it('create_eventosDelMotor_lleganAlSinkEtiquetadosConSuSessionId', () => {
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink);
    const event: MageEvent = { kind: 'assistant_text', text: 'hola' };

    h.created[0]?.deps.emit(event);

    expect(h.payloads).toEqual([{ sessionId, event }]);
  });

  it('create_variasSesiones_conviven', () => {
    const h = harness();

    const first = h.manager.create(params(), h.sink);
    const second = h.manager.create(params(), h.sink);

    expect(first).not.toBe(second);
    expect(h.created).toHaveLength(2);
  });

  it('create_reanudarUnaConversacionYaViva_lanzaSinPisarLaSesionExistente', () => {
    // Dos procesos del CLI sobre la misma transcripcion la corrompen. Es alcanzable: `projects/` esta
    // compartido por junction entre cuentas, asi que la misma conversacion se puede reabrir desde otra.
    const h = harness();
    h.manager.create(params({ resumeSessionId: 'previa-123' }), h.sink);

    expect(() => h.manager.create(params({ resumeSessionId: 'previa-123' }), h.sink)).toThrow(/ya esta abierta/i);
    expect(h.created).toHaveLength(1); // no se instancio ni arranco una segunda
  });

  it('create_trasCerrarLaPestana_puedeReanudarseDeNuevo', () => {
    // La guarda es sobre sesiones VIVAS: al cerrar la pestana, la conversacion vuelve a ser reanudable.
    const h = harness();
    const sessionId = h.manager.create(params({ resumeSessionId: 'previa-123' }), h.sink);
    h.manager.stop(sessionId);

    expect(() => h.manager.create(params({ resumeSessionId: 'previa-123' }), h.sink)).not.toThrow();
    expect(h.created).toHaveLength(2);
  });

  it('create_modeloVacio_lanzaSinCrearSesion', () => {
    // La validacion vive en resolveLaunchParams; lo que se comprueba aqui es que se valida ANTES de
    // instanciar y arrancar nada.
    const h = harness();

    expect(() => h.manager.create(params({ model: '  ' }), h.sink)).toThrow(/modelo/i);
    expect(h.created).toHaveLength(0);
  });
});

describe('SessionManager delegacion y ciclo de vida', () => {
  it('sendMessage_sesionExistente_delegaEnElla', () => {
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink);

    h.manager.sendMessage(sessionId, 'hola');

    // Sin adjuntos se delega con la lista vacia: el adapter ve `[]` y manda el payload de siempre.
    expect(h.created[0]?.session.sendUserMessage).toHaveBeenCalledWith('hola', []);
  });

  it('answerPermission_delegaConRequestIdYDecision', () => {
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink);

    h.manager.answerPermission(sessionId, 'r1', { behavior: 'allow' });

    expect(h.created[0]?.session.answerPermission).toHaveBeenCalledWith('r1', { behavior: 'allow' });
  });

  it('interrupt_setModel_setPermissionMode_delegan', () => {
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink);

    h.manager.interrupt(sessionId);
    h.manager.setModel(sessionId, 'opus');
    h.manager.setPermissionMode(sessionId, 'plan');

    expect(h.created[0]?.session.interrupt).toHaveBeenCalledTimes(1);
    expect(h.created[0]?.session.setModel).toHaveBeenCalledWith('opus');
    expect(h.created[0]?.session.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('sendMessage_sesionInexistente_lanzaConElId', () => {
    const h = harness();

    expect(() => h.manager.sendMessage('no-existe', 'hola')).toThrow(/no-existe/);
  });

  it('stop_paraLaSesionYLaSacaDelRegistro', () => {
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink);

    h.manager.stop(sessionId);

    expect(h.created[0]?.session.stop).toHaveBeenCalledTimes(1);
    expect(() => h.manager.sendMessage(sessionId, 'hola')).toThrow(/inexistente/i);
  });

  it('stop_dosVeces_laSegundaLanza', () => {
    // Contrato explicito: parar algo que ya no existe es un error del llamador, no un no-op silencioso.
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink);
    h.manager.stop(sessionId);

    expect(() => h.manager.stop(sessionId)).toThrow(/inexistente/i);
  });

  it('stopAll_paraTodasYVaciaElRegistro', () => {
    const h = harness();
    const first = h.manager.create(params(), h.sink);
    const second = h.manager.create(params(), h.sink);

    h.manager.stopAll();

    expect(h.created[0]?.session.stop).toHaveBeenCalledTimes(1);
    expect(h.created[1]?.session.stop).toHaveBeenCalledTimes(1);
    expect(() => h.manager.sendMessage(first, 'x')).toThrow(/inexistente/i);
    expect(() => h.manager.sendMessage(second, 'x')).toThrow(/inexistente/i);
  });

  it('stopAll_sinSesiones_noLanza', () => {
    const h = harness();

    expect(() => h.manager.stopAll()).not.toThrow();
  });

  it('stopOwnedBy_dueñoConSesiones_paraSoloLasSuyas', () => {
    const h = harness();
    const mine = h.manager.create(params(), h.sink, 7);
    const other = h.manager.create(params(), h.sink, 8);

    const stopped = h.manager.stopOwnedBy(7);

    expect(stopped).toBe(1);
    expect(h.created[0]?.session.stop).toHaveBeenCalledTimes(1);
    expect(h.created[1]?.session.stop).not.toHaveBeenCalled();
    expect(() => h.manager.sendMessage(mine, 'x')).toThrow(/inexistente/i);
    expect(() => h.manager.sendMessage(other, 'x')).not.toThrow();
  });

  it('stopOwnedBy_sesionYaParadaPorElRenderer_noLaParaDosVeces', () => {
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink, 7);
    h.manager.stop(sessionId);

    expect(h.manager.stopOwnedBy(7)).toBe(0);
    expect(h.created[0]?.session.stop).toHaveBeenCalledTimes(1);
  });

  it('stopOwnedBy_sesionSinDueño_noSeToca', () => {
    const h = harness();
    h.manager.create(params(), h.sink);

    expect(h.manager.stopOwnedBy(7)).toBe(0);
    expect(h.created[0]?.session.stop).not.toHaveBeenCalled();
  });

  it('stopByConfigDir_paraLaCuentaYSuPerfilPrivado_yNoLasDeOtras', () => {
    // Arrange: dos de la cuenta p (compartida y privada) y una de la principal.
    const h = harness();
    const account = `${HOME}/.claude-p`;
    const shared = h.manager.create(params({ accountDir: account }), h.sink);
    const priv = h.manager.create(params({ accountDir: `${account}/mage-private` }), h.sink);
    const other = h.manager.create(params(), h.sink);

    // Act
    const stopped = h.manager.stopByConfigDir(account);

    // Assert
    expect(stopped).toBe(2);
    expect(() => h.manager.sendMessage(shared, 'x')).toThrow(/inexistente/i);
    expect(() => h.manager.sendMessage(priv, 'x')).toThrow(/inexistente/i);
    expect(() => h.manager.sendMessage(other, 'x')).not.toThrow();
  });

  it('stopByConfigDir_sinSesionesDeEsaCuenta_devuelveCero', () => {
    const h = harness();
    h.manager.create(params(), h.sink);

    expect(h.manager.stopByConfigDir(`${HOME}/.claude-z`)).toBe(0);
  });
});

// P-028: `/clear` abre otra conversacion en el mismo proceso y la sesion pasa a llamarse como ella.
describe('SessionManager tras conversation_reset', () => {
  const reset = (newSessionId: string): MageEvent => ({ kind: 'conversation_reset', newSessionId });

  it('conversationReset_elResetSaleConElIdViejoYLoSiguienteConElNuevo', () => {
    const h = harness();
    const oldId = h.manager.create(params(), h.sink);
    const event: MageEvent = { kind: 'assistant_text', text: 'hola' };

    h.created[0]?.deps.emit(reset('nuevo'));
    h.created[0]?.deps.emit(event);

    expect(h.payloads).toEqual([{ sessionId: oldId, event: reset('nuevo') }, { sessionId: 'nuevo', event }]);
  });

  it('conversationReset_laSesionSeManejaConElIdNuevo', () => {
    const h = harness();
    const oldId = h.manager.create(params(), h.sink);
    h.created[0]?.deps.emit(reset('nuevo'));

    h.manager.sendMessage('nuevo', 'hola');

    expect(h.created[0]?.session.sendUserMessage).toHaveBeenCalledWith('hola', []);
    expect(() => h.manager.sendMessage(oldId, 'hola')).toThrow(/inexistente/i);
    h.manager.stop('nuevo');
    expect(h.created[0]?.session.stop).toHaveBeenCalledTimes(1);
  });

  it('conversationReset_stopByConfigDir_paraLaSesionReEtiquetada', () => {
    // P-028 30 + /clear: el config dir viaja con la sesion al cambiar de id.
    const h = harness();
    const account = `${HOME}/.claude-p`;
    h.manager.create(params({ accountDir: account }), h.sink);
    h.created[0]?.deps.emit(reset('nuevo'));

    expect(h.manager.stopByConfigDir(account)).toBe(1);
    expect(h.created[0]?.session.stop).toHaveBeenCalledTimes(1);
  });

  it('conversationReset_idOcupadoPorOtraSesion_conservaElViejo', () => {
    const h = harness();
    const first = h.manager.create(params(), h.sink);
    const second = h.manager.create(params(), h.sink);

    h.created[0]?.deps.emit(reset(second));

    expect(() => h.manager.sendMessage(first, 'hola')).not.toThrow();
    expect(h.created[0]?.session.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it('stopOwnedBy_trasUnClear_sigueParandoLaSesionReEtiquetada', () => {
    const h = harness();
    const sessionId = h.manager.create(params(), h.sink, 7);

    h.created[0]?.deps.emit(reset('id-nuevo'));

    expect(h.manager.stopOwnedBy(7)).toBe(1);
    expect(h.created[0]?.session.stop).toHaveBeenCalledTimes(1);
    expect(sessionId).not.toBe('id-nuevo');
  });
});
