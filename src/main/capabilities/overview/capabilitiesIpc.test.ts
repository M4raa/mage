import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import type { CapabilitiesOverview } from '@shared/capabilities';
import { registerCapabilitiesIpc } from './capabilitiesIpc';

type Listener = (event: unknown, arg: unknown) => unknown;

const KNOWN = '/a/.claude';

function setup() {
  const handlers = new Map<string, Listener>();
  const overview = vi.fn((accountDir: string) => ({ accountDir }) as unknown as CapabilitiesOverview);
  registerCapabilitiesIpc({
    handle: (channel, listener) => void handlers.set(channel, listener),
    overview,
    claudeAccountDirs: () => [KNOWN],
  });
  const call = (arg?: unknown): unknown => (handlers.get(IpcChannel.CapabilitiesOverview) as Listener)(null, arg);
  return { handlers, overview, call };
}

describe('registerCapabilitiesIpc', () => {
  it('registerCapabilitiesIpc_registraElCanal', () => {
    const { handlers } = setup();

    expect([...handlers.keys()]).toEqual([IpcChannel.CapabilitiesOverview]);
  });

  it('capabilitiesOverview_cuentaConocida_llamaAlLector', () => {
    const { call, overview } = setup();

    const result = call(KNOWN);

    expect(overview).toHaveBeenCalledWith(KNOWN);
    expect(result).toEqual({ accountDir: KNOWN });
  });

  it('capabilitiesOverview_cuentaDesconocida_lanzaConElValor', () => {
    const { call, overview } = setup();

    expect(() => call('/otra/ruta')).toThrow('/otra/ruta');
    expect(overview).not.toHaveBeenCalled();
  });

  it('capabilitiesOverview_noTexto_lanza', () => {
    const { call } = setup();

    expect(() => call(42)).toThrow('42');
  });
});
