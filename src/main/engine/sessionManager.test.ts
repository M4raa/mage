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
  return { homedir: HOME, fileExists: () => true, listHome: () => ['.claude'], resolveSharedConfigArgs: () => [] };
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

  const adapterFactory = (provider: string): ProviderAdapter => {
    providers.push(provider);
    return {} as ProviderAdapter; // el manager solo lo pasa a la sesion; no lo usa
  };

  const manager = new SessionManager(adapterFactory, defaults(), undefined, (deps) => {
    const session: ManagedSession = {
      start: vi.fn(),
      sendUserMessage: vi.fn(),
      answerPermission: vi.fn(),
      interrupt: vi.fn(),
      setModel: vi.fn(),
      setPermissionMode: vi.fn(),
      stop: vi.fn(),
    };
    created.push({ deps, session });
    return session;
  });

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

  it('create_proveedorNoClaudeConResumeSessionId_ignoraElResumeYArrancaFresca', () => {
    // Solo Claude soporta --resume; los adapters por gateway arrancan sesion nueva con id nuevo.
    const h = harness();

    const sessionId = h.manager.create(params({ provider: 'gemini', resumeSessionId: 'previa-123' }), h.sink);

    expect(sessionId).not.toBe('previa-123');
    expect(h.launchOf(0).resume).toBe(false);
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
});
