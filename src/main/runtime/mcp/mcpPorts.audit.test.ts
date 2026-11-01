import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@shared/i18n/translator';
import { LoopbackCallback } from './mcpSdk';

const translate = createTranslator('es');

// A13: el puerto efímero que da el SO puede ser uno que el navegador bloquea («bad port»). `listen` se
// inyecta: escucha de verdad en un puerto libre, pero `address()` informa del puerto que pide el caso.
const servers: Server[] = [];

function listenReporting(ports: readonly number[]): (port: number) => Promise<Server> {
  return async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const reported = ports[Math.min(servers.length - 1, ports.length - 1)] ?? 0;
    vi.spyOn(server, 'address').mockReturnValue({ address: '127.0.0.1', family: 'IPv4', port: reported });
    return server;
  };
}

afterEach(() => {
  for (const server of servers.splice(0)) if (server.listening) server.close();
});

describe('LoopbackCallback.listen — A13', () => {
  it('listen_efimeroBloqueado_loCierraYVuelveAEscuchar', async () => {
    const callback = await LoopbackCallback.listen(null, 'fixture', translate, listenReporting([6000, 53551]));

    expect(callback.redirectUrl).toBe('http://127.0.0.1:53551/callback');
    expect(servers[0]?.listening).toBe(false);
    callback.close();
  });

  it('listen_puertoExplicitoBloqueado_lanzaSinEscuchar', async () => {
    const listen = vi.fn();

    await expect(LoopbackCallback.listen(6000, 'fixture', translate, listen)).rejects.toThrow('6000');
    expect(listen).not.toHaveBeenCalled();
  });

  it('listen_puertoExplicitoBloqueado_lanzaLaClaveConElPuerto', async () => {
    await expect(LoopbackCallback.listen(6000, 'fixture', translate, vi.fn())).rejects.toThrow(
      expect.objectContaining({ localized: { key: 'errors.runtime.mcpCallbackPortBlocked', values: { port: '6000' } } }),
    );
  });

  it('listen_puertoExplicitoPermitido_loRespeta', async () => {
    const listen = vi.fn(listenReporting([53552]));

    const callback = await LoopbackCallback.listen(53552, 'fixture', translate, listen);

    expect(listen).toHaveBeenCalledWith(53552);
    expect(callback.redirectUrl).toBe('http://127.0.0.1:53552/callback');
    callback.close();
  });

  it('listen_siempreBloqueado_agotaLosIntentosYNoDejaServidoresAbiertos', async () => {
    await expect(LoopbackCallback.listen(null, 'fixture', translate, listenReporting([6665]))).rejects.toThrow('intentos');
    expect(servers.length).toBeGreaterThan(1);
    expect(servers.every((server) => !server.listening)).toBe(true);
  });
});
