import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { HOST_PROTOCOL as SERVER_PROTOCOL } from '../../src/main/host/hostProtocol.ts';
import { CHALLENGE_CONTEXT as SERVER_CONTEXT, CHALLENGE_NONCE_BYTES as SERVER_NONCE_BYTES, challengeProof } from '../../src/main/host/hostToken.ts';
import {
  CHALLENGE_CONTEXT, CHALLENGE_NONCE_BYTES, HOST_PROTOCOL, NOT_MAGE_SERVER,
  computeProof, connectVerified, createRpc, readHostFiles, verifyUnixEndpoint,
} from './hostLink.mjs';

const TOKEN = 'a'.repeat(64);
const NONCE = '0'.repeat(64);
const HELLO_RESULT = { protocol: '1.2', hostVersion: '0.1.3', capabilities: [] };

class FakeSocket extends EventEmitter {
  writes = [];
  destroyed = false;
  write(text) { this.writes.push(text); this.respond?.(JSON.parse(text)); return true; }
  end() { this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
  reply(message) { queueMicrotask(() => this.emit('data', Buffer.from(`${JSON.stringify(message)}\n`))); }
}

const throwing = (name) => () => { throw new Error(`${name} no debía llamarse`); };

function deps(socket, overrides = {}) {
  return {
    platform: 'win32',
    readFile: (file) => (file.endsWith('host-endpoint') ? '\\\\.\\pipe\\mage-x-v1' : TOKEN),
    connect: async () => socket,
    randomBytes: (n) => Buffer.alloc(n, 0),
    lstat: throwing('lstat'),
    getuid: throwing('getuid'),
    ...overrides,
  };
}

const connect = (socket, overrides) => connectVerified({ userDataDir: 'C:\\perfil', clientVersion: 't', deps: deps(socket, overrides) });
const expectRejectedWithoutToken = async (socket) => {
  await expect(connect(socket)).rejects.toThrow(NOT_MAGE_SERVER);
  expect(socket.writes).toHaveLength(1);
  expect(socket.writes.join('')).not.toContain(TOKEN);
  expect(socket.writes.join('')).not.toContain('"hello"');
};

describe('hostLink', () => {
  it('deriva_constantesIgualesQueElServidor', () => {
    expect(HOST_PROTOCOL).toBe(SERVER_PROTOCOL);
    expect(CHALLENGE_CONTEXT).toBe(SERVER_CONTEXT);
    expect(CHALLENGE_NONCE_BYTES).toBe(SERVER_NONCE_BYTES);
    expect(computeProof('a'.repeat(64), '0'.repeat(64))).toBe(challengeProof('a'.repeat(64), '0'.repeat(64)));
  });

  it('connectVerified_servidorBueno_mandaElRetoYDespuesHelloConElToken', async () => {
    const socket = new FakeSocket();
    socket.respond = (request) => {
      if (request.method === 'host.challenge') socket.reply({ jsonrpc: '2.0', id: request.id, result: { proof: computeProof(TOKEN, request.params.nonce) } });
      else socket.reply({ jsonrpc: '2.0', id: request.id, result: HELLO_RESULT });
    };

    const { hello } = await connect(socket);

    const [first, second] = socket.writes.map((line) => JSON.parse(line));
    expect(socket.writes[0]).not.toContain(TOKEN);
    expect(first.method).toBe('host.challenge');
    expect(second.method).toBe('hello');
    expect(second.params.token).toBe(TOKEN);
    expect(second.params.protocol).toBe('1.5');
    expect(hello).toEqual(HELLO_RESULT);
  });

  it('connectVerified_pruebaDeOtroToken_rechazaSinEnviarElToken', async () => {
    const socket = new FakeSocket();
    socket.respond = (request) => socket.reply({ jsonrpc: '2.0', id: request.id, result: { proof: computeProof('b'.repeat(64), NONCE) } });

    await expectRejectedWithoutToken(socket);

    expect(socket.destroyed).toBe(true);
  });

  it('connectVerified_impostorCierraSinResponder_rechazaSinEnviarElToken', async () => {
    const socket = new FakeSocket();
    socket.respond = () => queueMicrotask(() => socket.emit('close'));

    await expectRejectedWithoutToken(socket);
  });

  it('connectVerified_impostorRespondeConError_rechazaSinEnviarElToken', async () => {
    const socket = new FakeSocket();
    socket.respond = (request) => socket.reply({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'x' } });

    await expectRejectedWithoutToken(socket);
  });

  it.each([{ proof: 'ZZ' }, { proof: 7 }, {}, null])('connectVerified_pruebaMalFormada_rechaza %j', async (result) => {
    const socket = new FakeSocket();
    socket.respond = (request) => socket.reply({ jsonrpc: '2.0', id: request.id, result });

    await expectRejectedWithoutToken(socket);
  });

  it('connectVerified_lineaIlegible_rechazaSinEnviarElToken', async () => {
    const socket = new FakeSocket();
    socket.respond = () => queueMicrotask(() => socket.emit('data', Buffer.from('no-json\n')));

    await expectRejectedWithoutToken(socket);

    expect(socket.destroyed).toBe(true);
  });

  it('readHostFiles_faltaElToken_errorConLaRutaYSinContenido', () => {
    const readFile = (file) => {
      if (file.endsWith('host-token')) throw Object.assign(new Error('x'), { code: 'ENOENT' });
      return 'endpoint';
    };

    const act = () => readHostFiles('C:\\perfil', { platform: 'win32', readFile });

    expect(act).toThrow('host-token');
    expect(act).toThrow('No hay un Mage escuchando');
  });

  it('readHostFiles_ficheroVacio_error', () => {
    const readFile = (file) => (file.endsWith('host-token') ? '  \n' : 'endpoint');

    const act = () => readHostFiles('C:\\perfil', { platform: 'win32', readFile });

    expect(act).toThrow('Fichero del host vacío');
  });
});

describe('verifyUnixEndpoint', () => {
  const dir = (overrides = {}) => ({ mode: 0o40700, uid: 1000, isDirectory: () => true, isSocket: () => false, ...overrides });
  const sock = (overrides = {}) => ({ mode: 0o140600, uid: 1000, isDirectory: () => false, isSocket: () => true, ...overrides });
  const unixDeps = (directory, socket) => ({
    platform: 'linux',
    getuid: () => 1000,
    lstat: (path) => (path.endsWith('.sock') ? socket : directory),
  });
  const ADDRESS = '/run/user/1000/mage/abc.sock';

  it('verifyUnixEndpoint_win32_noMiraNada', () => {
    const act = () => verifyUnixEndpoint('\\\\.\\pipe\\x', { platform: 'win32', lstat: throwing('lstat'), getuid: throwing('getuid') });

    expect(act).not.toThrow();
  });

  it('verifyUnixEndpoint_privados_pasa', () => {
    const act = () => verifyUnixEndpoint(ADDRESS, unixDeps(dir(), sock()));

    expect(act).not.toThrow();
  });

  it('verifyUnixEndpoint_socketLegiblePorElGrupo_lanza', () => {
    const act = () => verifyUnixEndpoint(ADDRESS, unixDeps(dir(), sock({ mode: 0o140660 })));

    expect(act).toThrow('socket del host no es privado');
  });

  it('verifyUnixEndpoint_directorioDeOtroUsuario_lanza', () => {
    const act = () => verifyUnixEndpoint(ADDRESS, unixDeps(dir({ uid: 0 }), sock()));

    expect(act).toThrow('directorio del host no es privado');
  });

  it('verifyUnixEndpoint_noEsSocket_lanza', () => {
    const act = () => verifyUnixEndpoint(ADDRESS, unixDeps(dir(), sock({ isSocket: () => false })));

    expect(act).toThrow('socket del host no es privado');
  });
});

describe('createRpc.notify', () => {
  it('notify_writesWithoutId', () => {
    const socket = new FakeSocket();
    const rpc = createRpc(socket);

    rpc.notify('mcp.message', { message: { a: 1 } });

    expect(JSON.parse(socket.writes[0])).toEqual({ jsonrpc: '2.0', method: 'mcp.message', params: { message: { a: 1 } } });
  });
});

describe('connectVerified — cliente mcp', () => {
  const CALLER = 'cd'.repeat(32);
  const helloOf = async (client) => {
    const socket = new FakeSocket();
    socket.respond = (request) => {
      if (request.method === 'host.challenge') socket.reply({ jsonrpc: '2.0', id: request.id, result: { proof: computeProof(TOKEN, request.params.nonce) } });
      else socket.reply({ jsonrpc: '2.0', id: request.id, result: HELLO_RESULT });
    };
    await connectVerified({ userDataDir: 'C:\\perfil', clientVersion: 't', deps: deps(socket), client });
    return JSON.parse(socket.writes[1]).params;
  };

  it('connectVerified_mcpClientWithCaller_helloHasCaller', async () => {
    const params = await helloOf({ kind: 'mcp', caller: CALLER });

    expect(params.client).toEqual({ kind: 'mcp', version: 't' });
    expect(params.caller).toBe(CALLER);
  });

  it.each(['XYZ', 'AB'.repeat(32), undefined])('connectVerified_badCaller_omitted_%s', async (caller) => {
    const params = await helloOf({ kind: 'mcp', caller });

    expect(params).not.toHaveProperty('caller');
  });
});

describe('createRpc', () => {
  it('createRpc_mensajeMultibytePartidoEnDosTrozos_seLeeEntero', async () => {
    const socket = new FakeSocket();
    const rpc = createRpc(socket);
    const bytes = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ñandú' })}\n`);
    const cut = bytes.indexOf(0xc3) + 1;

    const pending = rpc.call('x');
    socket.emit('data', bytes.subarray(0, cut));
    socket.emit('data', bytes.subarray(cut));

    await expect(pending).resolves.toBe('ñandú');
  });

  it('createRpc_errorSinId_rechazaTodasLasPendientes', async () => {
    const socket = new FakeSocket();
    const rpc = createRpc(socket);

    const first = rpc.call('a');
    const second = rpc.call('b');
    socket.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'cierre' } })}\n`));

    await expect(first).rejects.toMatchObject({ message: 'cierre', code: -32600 });
    await expect(second).rejects.toMatchObject({ message: 'cierre', code: -32600 });
  });
});
