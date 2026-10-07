import { describe, expect, it, vi } from 'vitest';
import { AgyAdapter, type AgyAdapterDeps } from './agyAdapter';
import type { LaunchParams, ProviderAdapter } from './providerAdapter';

const deps: AgyAdapterDeps = { resolveBinary: () => 'agy.exe' };
const adapter = new AgyAdapter(deps);

const launch: LaunchParams = {
  sessionId: 'mage-session-1',
  accountDir: '/home/u/.claude',
  model: 'gemini-3.6-flash-medium',
  cwd: '/proj',
};

// Valor que sigue a un flag en el array de argumentos (undefined si el flag no esta).
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function withEnv(values: Record<string, string>, body: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  try {
    body();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe('AgyAdapter (sesion persistente, agy 1.2.14)', () => {
  it('buildSpawnPlan_sesionNormal_entradaYSalidaStreamJsonModoAddDirYModelo', () => {
    const plan = adapter.buildSpawnPlan(launch);

    expect(plan.command).toBe('agy.exe');
    expect(valueAfter(plan.args, '--input-format')).toBe('stream-json');
    expect(valueAfter(plan.args, '--output-format')).toBe('stream-json');
    expect(valueAfter(plan.args, '--mode')).toBe('accept-edits');
    expect(valueAfter(plan.args, '--add-dir')).toBe('/proj');
    expect(valueAfter(plan.args, '--model')).toBe('gemini-3.6-flash-medium');
  });

  // Desde la 1.2.6 el tope por defecto es ilimitado: el `30m` de antes recortaba turnos.
  it('buildSpawnPlan_sesionNormal_noPasaPrintTimeoutNiPrint', () => {
    const plan = adapter.buildSpawnPlan(launch);

    expect(plan.args).not.toContain('--print-timeout');
    expect(plan.args).not.toContain('--print');
  });

  it('buildSpawnPlan_primerArranque_noPasaConversation', () => {
    expect(adapter.buildSpawnPlan(launch).args).not.toContain('--conversation');
  });

  it('buildSpawnPlan_relanzadoConConversationId_continuaLaConversacionDelProveedor', () => {
    expect(valueAfter(adapter.buildSpawnPlan({ ...launch, conversationId: 'agy-conv-7' }).args, '--conversation')).toBe('agy-conv-7');
  });

  it('buildSpawnPlan_conversationIdVacio_noPasaElFlag', () => {
    expect(adapter.buildSpawnPlan({ ...launch, conversationId: '' }).args).not.toContain('--conversation');
  });

  it.each(['low', 'medium', 'high', 'max'])('buildSpawnPlan_effortSoportado_%s_seAnade', (effort) => {
    expect(valueAfter(adapter.buildSpawnPlan({ ...launch, effort }).args, '--effort')).toBe(effort);
  });

  it.each(['xhigh', 'raro'])('buildSpawnPlan_effortQueAgyNoConoce_%s_seOmite', (effort) => {
    expect(adapter.buildSpawnPlan({ ...launch, effort }).args).not.toContain('--effort');
  });

  // Invariante: una cuenta de suscripcion no recibe NINGUNA clave, aunque el usuario la tenga exportada.
  it('buildSpawnPlan_suscripcionConClavesEnElEntorno_lasBorraDelProcesoHijo', () => {
    withEnv({ ANTHROPIC_API_KEY: 'sk-ant-xxx', GEMINI_API_KEY: 'gm-xxx', GOOGLE_API_KEY: 'go-xxx' }, () => {
      const plan = adapter.buildSpawnPlan(launch);

      expect(plan.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(plan.env.GEMINI_API_KEY).toBeUndefined();
      expect(plan.env.GOOGLE_API_KEY).toBeUndefined();
      expect(plan.env.USERPROFILE).toBe(process.env.USERPROFILE);
    });
  });

  it('buildSpawnPlan_cuentaPorClave_suPerfilSuClaveYHomeReal', () => {
    const prepareProfile = vi.fn();
    const keyed = new AgyAdapter({
      resolveBinary: () => 'agy.exe',
      resolveApiAccount: (dir) => (dir === '/data/agy-accounts/trabajo' ? { profileDir: dir, apiKey: 'gm-de-la-cuenta' } : null),
      prepareProfile,
    });

    withEnv({ GEMINI_API_KEY: 'gm-del-usuario' }, () => {
      const plan = keyed.buildSpawnPlan({ ...launch, accountDir: '/data/agy-accounts/trabajo' });

      expect(plan.env.GEMINI_API_KEY).toBe('gm-de-la-cuenta');
      expect(plan.env.USERPROFILE).toBe('/data/agy-accounts/trabajo');
      expect(plan.env.HOME).toBeDefined();
      expect(prepareProfile).toHaveBeenCalledWith('/data/agy-accounts/trabajo', '/proj', 'api-key');
    });
  });

  // Fase 2 del grupo E: la suscripcion tambien corre con perfil propio de Mage, sin clave.
  it('buildSpawnPlan_suscripcionConPerfilDeMage_suPerfilSinClaveYHomeReal', () => {
    const prepareProfile = vi.fn();
    const subscribed = new AgyAdapter({
      resolveBinary: () => 'agy.exe',
      resolveApiAccount: () => null,
      subscriptionProfileDir: () => '/data/agy-profile',
      prepareProfile,
    });

    withEnv({ GEMINI_API_KEY: 'gm-del-usuario' }, () => {
      const plan = subscribed.buildSpawnPlan(launch);

      expect(plan.env.GEMINI_API_KEY).toBeUndefined();
      expect(plan.env.USERPROFILE).toBe('/data/agy-profile');
      expect(plan.env.HOME).toBeDefined();
      expect(prepareProfile).toHaveBeenCalledWith('/data/agy-profile', '/proj', 'subscription');
    });
  });

  it('encodeUserMessage_soloTexto_lineaUserConContentString', () => {
    expect(adapter.encodeUserMessage('hola')).toEqual({ event: 'user', message: { content: 'hola' } });
  });

  // agy solo admite bloques `text` (medido): la imagen va a disco y su ruta al mensaje.
  it('encodeUserMessage_conImagen_guardaLaImagenYCitaSuRuta', () => {
    const saveAttachment = vi.fn(() => 'C:\\tmp\\img-1.png');
    const withImages = new AgyAdapter({ resolveBinary: () => 'agy.exe', saveAttachment });
    withImages.buildSpawnPlan(launch);

    const message = withImages.encodeUserMessage('mira [Imagen 1]', [{ mediaType: 'image/png', data: 'AAAA' }]) as { message: { content: string } };

    expect(saveAttachment).toHaveBeenCalledWith('mage-session-1', { mediaType: 'image/png', data: 'AAAA' }, 0);
    expect(message.message.content).toContain('[Imagen 1]: C:\\tmp\\img-1.png');
    expect(message.message.content).toContain('view_file');
  });

  it('encodeUserMessage_conImagenSinDondeGuardarla_lanza', () => {
    expect(() => adapter.encodeUserMessage('hola', [{ mediaType: 'image/png', data: 'AAAA' }])).toThrow(/imagenes/);
  });

  it('interruptsByKill_siempre_true', () => {
    expect(adapter.interruptsByKill).toBe(true);
  });

  it('encodePermissionResponse_siempre_lanzaPorqueNoHayPuenteDePermisos', () => {
    expect(() => adapter.encodePermissionResponse({ requestId: 'r1', toolUseId: 't1' }, { behavior: 'allow' })).toThrow(
      /permission-prompt-tool/,
    );
  });

  it('encodeSetModel_siempre_lanzaConElModeloPedido', () => {
    expect(() => adapter.encodeSetModel('gemini-3.1-pro-low')).toThrow(/"gemini-3.1-pro-low"/);
  });

  it('metodosOpcionalesQueAgyNoSoporta_noEstanDeclarados', () => {
    const asContract: ProviderAdapter = adapter;

    expect(asContract.encodeGetContextUsage).toBeUndefined();
    expect(asContract.encodeInitialize).toBeUndefined();
    expect(asContract.takeOutgoing).toBeUndefined();
  });

  // El uso del `result` es ACUMULADO por proceso (medido): el adapter da el de cada turno.
  it('normalize_dosResultsSeguidos_restaElUsoDelTurnoAnterior', () => {
    const local = new AgyAdapter(deps);
    local.buildSpawnPlan(launch);
    const result = (input: number, output: number): unknown => ({
      event: 'result',
      result: { status: 'SUCCESS', num_turns: 1, usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } },
    });

    local.normalize(result(12_215, 2));
    const second = local.normalize(result(24_513, 4)).find((event) => event.kind === 'result');

    expect(second).toMatchObject({ result: { usage: { inputTokens: 12_298, outputTokens: 2, totalTokens: 12_300 } } });
  });

  it('normalize_trasRelanzar_elUsoVuelveACero', () => {
    const local = new AgyAdapter(deps);
    local.buildSpawnPlan(launch);
    local.normalize({ event: 'result', result: { status: 'SUCCESS', usage: { input_tokens: 100 } } });

    local.buildSpawnPlan({ ...launch, conversationId: 'c1' });
    const after = local.normalize({ event: 'result', result: { status: 'SUCCESS', usage: { input_tokens: 40 } } });

    expect(after.find((event) => event.kind === 'result')).toMatchObject({ result: { usage: { inputTokens: 40 } } });
  });
});

// Puente de instrucciones (grupo H), medido con `node spike/agy-spike.mjs --instructions` en agy 1.2.16.
describe('AgyAdapter: puente de instrucciones', () => {
  const PROFILE = 'C:\\mage\\agy-profile';
  const profiled = (bridge: AgyAdapterDeps['bridgeInstructions']): AgyAdapter =>
    new AgyAdapter({ resolveBinary: () => 'agy.exe', subscriptionProfileDir: () => PROFILE, bridgeInstructions: bridge });
  const addDirs = (args: readonly string[]): readonly (string | undefined)[] => args.flatMap((arg, index) => (arg === '--add-dir' ? [args[index + 1]] : []));

  it('buildSpawnPlan_conPuente_anadeSuCarpetaConOtroAddDir', () => {
    const plan = profiled(() => 'C:\\Temp\\mage-agy-instructions\\s1').buildSpawnPlan(launch);

    expect(addDirs(plan.args)).toEqual(['/proj', 'C:\\Temp\\mage-agy-instructions\\s1']);
  });

  it('buildSpawnPlan_sinNadaQuePuentear_soloElAddDirDelCwd', () => {
    const plan = profiled(() => null).buildSpawnPlan(launch);

    expect(addDirs(plan.args)).toEqual(['/proj']);
  });

  it('buildSpawnPlan_puente_recibeLaSesionElCwdYElPerfil', () => {
    const bridge = vi.fn(() => null);

    profiled(bridge).buildSpawnPlan(launch);

    expect(bridge).toHaveBeenCalledWith('mage-session-1', '/proj', PROFILE, undefined);
  });

  it('buildSpawnPlan_entregaLasReglasDelProyectoAlPuente', () => {
    const bridge = vi.fn(() => 'C:\\Temp\\mage-agy-instructions\\s1');
    profiled(bridge).buildSpawnPlan({ ...launch, projectInstructions: 'Eres experto en Python' });
    expect(bridge).toHaveBeenCalledWith('mage-session-1', '/proj', PROFILE, 'Eres experto en Python');
  });

  it('buildSpawnPlan_sinPerfilDeMage_noPuentea', () => {
    const bridge = vi.fn(() => 'C:\\x');

    const plan = new AgyAdapter({ resolveBinary: () => 'agy.exe', bridgeInstructions: bridge }).buildSpawnPlan(launch);

    expect(bridge).not.toHaveBeenCalled();
    expect(addDirs(plan.args)).toEqual(['/proj']);
  });
});
