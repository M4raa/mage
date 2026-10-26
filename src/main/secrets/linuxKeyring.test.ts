import { describe, expect, it, vi } from 'vitest';
import { DBUS_QUERY_TIMEOUT_MS, KEYRING_CHECK_BUDGET_MS, detectLinuxKeyring, hasSessionBus, type BusCall, type KeyringDetectorDeps } from './linuxKeyring';

// Respuestas literales de `dbus-send --print-reply` (las de la sonda de F0.5c).
const OWNER_TRUE = 'method return time=1 sender=org.freedesktop.DBus -> destination=:1.2 serial=3 reply_serial=2\n   boolean true\n';
const OWNER_FALSE = 'method return time=1 sender=org.freedesktop.DBus -> destination=:1.2 serial=3 reply_serial=2\n   boolean false\n';
const ALIAS_LOGIN = 'method return time=1 sender=:1.1 -> destination=:1.2 serial=4 reply_serial=2\n   object path "/org/freedesktop/secrets/collection/login"\n';
const ALIAS_NONE = 'method return time=1 sender=:1.1 -> destination=:1.2 serial=4 reply_serial=2\n   object path "/"\n';
const LOCKED_TRUE = 'method return time=1 sender=:1.1 -> destination=:1.2 serial=5 reply_serial=2\n   variant       boolean true\n';
const LOCKED_FALSE = 'method return time=1 sender=:1.1 -> destination=:1.2 serial=5 reply_serial=2\n   variant       boolean false\n';

// Bus falso: responde por método, en orden.
function bus(replies: Readonly<Record<string, string | Error>>): BusCall & ReturnType<typeof vi.fn> {
  return vi.fn(async (_destination: string, _path: string, method: string) => {
    const reply = replies[method];
    if (reply === undefined) throw new Error(`Llamada inesperada: ${method}`);
    if (reply instanceof Error) throw reply;
    return reply;
  });
}

function deps(overrides: Partial<KeyringDetectorDeps> = {}): KeyringDetectorDeps {
  return { hasSessionBus: true, providerInstalled: () => true, busCall: bus({}), now: () => 0, ...overrides };
}

const UNLOCKED_REPLIES = {
  'org.freedesktop.DBus.NameHasOwner': OWNER_TRUE,
  'org.freedesktop.Secret.Service.ReadAlias': ALIAS_LOGIN,
  'org.freedesktop.DBus.Properties.Get': LOCKED_FALSE,
};

describe('hasSessionBus', () => {
  it.each([
    [{ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' }, true],
    [{ DBUS_SESSION_BUS_ADDRESS: 'disabled:' }, false],
    [{ DBUS_SESSION_BUS_ADDRESS: '' }, false],
    [{}, false],
  ])('hasSessionBus_%o_%s', (env, expected) => {
    expect(hasSessionBus(env)).toBe(expected);
  });
});

describe('detectLinuxKeyring', () => {
  it('detect_sinBusDeSesion_sinArrancarSinPreguntarAlBus', async () => {
    const busCall = bus({});

    const result = await detectLinuxKeyring(deps({ hasSessionBus: false, busCall }));

    expect(result).toEqual({ state: 'not-running', detail: null });
    expect(busCall).not.toHaveBeenCalled();
  });

  it('detect_sinBusYSinProveedor_ausente', async () => {
    expect(await detectLinuxKeyring(deps({ hasSessionBus: false, providerInstalled: () => false }))).toEqual({ state: 'absent', detail: null });
  });

  it('detect_servicioSinPropietario_sinArrancarYNoLeHablaAlServicio', async () => {
    const busCall = bus({ 'org.freedesktop.DBus.NameHasOwner': OWNER_FALSE });

    const result = await detectLinuxKeyring(deps({ busCall }));

    expect(result.state).toBe('not-running');
    // Solo se preguntó al bus: hablarle a org.freedesktop.secrets podría activarlo.
    expect(busCall.mock.calls.map(([destination]) => destination)).toEqual(['org.freedesktop.DBus']);
  });

  it('detect_sinPropietarioNiProveedor_ausente', async () => {
    expect((await detectLinuxKeyring(deps({ providerInstalled: () => false, busCall: bus({ 'org.freedesktop.DBus.NameHasOwner': OWNER_FALSE }) }))).state).toBe('absent');
  });

  it('detect_coleccionBloqueada_bloqueado', async () => {
    const result = await detectLinuxKeyring(deps({ busCall: bus({ ...UNLOCKED_REPLIES, 'org.freedesktop.DBus.Properties.Get': LOCKED_TRUE }) }));

    expect(result).toEqual({ state: 'locked', detail: null });
  });

  it('detect_sinColeccionPorDefecto_sinColeccion', async () => {
    const result = await detectLinuxKeyring(deps({ busCall: bus({ ...UNLOCKED_REPLIES, 'org.freedesktop.Secret.Service.ReadAlias': ALIAS_NONE }) }));

    expect(result).toEqual({ state: 'no-collection', detail: null });
  });

  it('detect_desbloqueado_preguntaPorLaColeccionDeLaRespuesta', async () => {
    const busCall = bus(UNLOCKED_REPLIES);

    const result = await detectLinuxKeyring(deps({ busCall }));

    expect(result).toEqual({ state: 'unlocked', detail: null });
    expect(busCall.mock.calls[2]?.[1]).toBe('/org/freedesktop/secrets/collection/login');
  });

  it('detect_errorDelBus_errorConSuDetalleYNoAusente', async () => {
    const result = await detectLinuxKeyring(deps({ busCall: bus({ ...UNLOCKED_REPLIES, 'org.freedesktop.Secret.Service.ReadAlias': new Error('org.freedesktop.DBus.Error.NoReply') }) }));

    expect(result).toEqual({ state: 'error', detail: 'org.freedesktop.DBus.Error.NoReply' });
  });

  it('detect_respuestaSinRuta_error', async () => {
    const result = await detectLinuxKeyring(deps({ busCall: bus({ ...UNLOCKED_REPLIES, 'org.freedesktop.Secret.Service.ReadAlias': 'basura' }) }));

    expect(result.state).toBe('error');
    expect(result.detail).toMatch(/ReadAlias sin ruta de objeto: basura/);
  });

  it('detect_cadaConsulta_500msComoMaximo', async () => {
    const busCall = bus(UNLOCKED_REPLIES);

    await detectLinuxKeyring(deps({ busCall }));

    expect(busCall.mock.calls.map((call) => call[4])).toEqual([DBUS_QUERY_TIMEOUT_MS, DBUS_QUERY_TIMEOUT_MS, DBUS_QUERY_TIMEOUT_MS]);
  });

  it('detect_quedaPocoPlazo_laConsultaSoloTieneLoQueQueda', async () => {
    let clock = 0;
    const busCall = vi.fn(async (_d: string, _p: string, method: string, _args: readonly string[], _timeoutMs: number) => {
      clock += method === 'org.freedesktop.DBus.NameHasOwner' ? KEYRING_CHECK_BUDGET_MS - 100 : 0;
      return UNLOCKED_REPLIES[method as keyof typeof UNLOCKED_REPLIES];
    });

    await detectLinuxKeyring(deps({ busCall, now: () => clock }));

    expect(busCall.mock.calls[1]?.[4]).toBe(100);
  });

  it('detect_plazoTotalAgotado_errorSinLanzarLaSiguienteConsulta', async () => {
    let clock = 0;
    const busCall = vi.fn(async () => {
      clock += KEYRING_CHECK_BUDGET_MS;
      return OWNER_TRUE;
    });

    const result = await detectLinuxKeyring(deps({ busCall, now: () => clock }));

    expect(result.state).toBe('error');
    expect(result.detail).toMatch(/3000 ms/);
    expect(busCall).toHaveBeenCalledTimes(1);
  });
});
