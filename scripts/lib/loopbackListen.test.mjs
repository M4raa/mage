import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { FETCH_BLOCKED_PORTS as PRODUCTION_BLOCKED_PORTS } from '../../src/main/runtime/mcp/mcpSdk.ts';
import { FETCH_BLOCKED_PORTS, listenLoopback } from './loopbackListen.mjs';

// Servidor falso: cada `listen` asigna el siguiente puerto de `ports`; cuenta los `close`.
function fakeServer(ports) {
  let next = 0;
  let current = null;
  const server = {
    closes: 0,
    once: () => server,
    off: () => server,
    listen: (_port, _host, callback) => {
      current = ports[Math.min(next++, ports.length - 1)];
      callback();
    },
    address: () => ({ port: current }),
    close: (callback) => {
      server.closes += 1;
      callback();
    },
  };
  return server;
}

describe('listenLoopback', () => {
  it('listenLoopback_puertoLibre_loDevuelve', async () => {
    // Arrange
    const server = http.createServer();

    // Act
    const port = await listenLoopback(server);

    // Assert
    try {
      expect(port).toBe(server.address().port);
      expect(FETCH_BLOCKED_PORTS.has(port)).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('listenLoopback_puertoBloqueado_pideOtro', async () => {
    // Arrange
    const server = fakeServer([6665, 40001]);

    // Act
    const port = await listenLoopback(server);

    // Assert
    expect(port).toBe(40001);
    expect(server.closes).toBe(1);
  });

  it('listenLoopback_todosBloqueados_lanzaConLosIntentos', async () => {
    // Arrange
    const server = fakeServer([6000]);

    // Act
    const run = listenLoopback(server, { attempts: 3 });

    // Assert
    await expect(run).rejects.toThrow('3 intentos');
    expect(server.closes).toBe(3);
  });

  it('FETCH_BLOCKED_PORTS_igualQueElDeProduccion', () => {
    // Arrange
    const production = [...PRODUCTION_BLOCKED_PORTS].sort((a, b) => a - b);

    // Act
    const scripts = [...FETCH_BLOCKED_PORTS].sort((a, b) => a - b);

    // Assert
    expect(scripts).toEqual(production);
  });
});
