import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSnapshot } from '@shared/coordination';
import { HostErrorCode, HOST_PROTOCOL } from './hostProtocol';
import { endpointFilePath, modeFilePath, resolveHostEndpoint, tokenFilePath } from './hostEndpoint';
import { startHostServer, type HostFs, type HostServerDeps, type HostServerHandle } from './hostServer';
import type { HostSessions } from './hostConnection';

// Prueba de integración con transporte real: named pipe en Windows, socket Unix en el resto.
const TOKEN = 'c'.repeat(64);
const SNAPSHOT: ConversationSnapshot = { sessionId: 's1', provider: 'claude', conversationId: 'c1', nativeRef: null, lastSeq: 3, state: 'idle', queue: [], pending: [], background: false };
const posixOnly = process.platform === 'win32' ? it.skip : it;

const roots: string[] = [];
const handles: HostServerHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fakeSessions(): HostSessions {
  return {
    listSessions: () => [SNAPSHOT],
    snapshot: () => SNAPSHOT,
    subscribe: () => ({ snapshot: SNAPSHOT, unsubscribe: () => undefined }),
    send: () => ({ status: 'accepted', commandId: 'k' }),
    interrupt: () => [],
    answerPermission: () => ({ status: 'accepted' }),
    answerElicitation: () => ({ status: 'accepted' }),
  };
}

async function start(prepare: (userData: string) => void = () => undefined) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-host-'));
  roots.push(userDataDir);
  prepare(userDataDir);
  const deps = { platform: process.platform, userDataDir, xdgRuntimeDir: undefined };
  const endpoint = resolveHostEndpoint(deps);
  const handle = await startHostServer(serverDeps(userDataDir));
  handles.push(handle);
  return { endpoint, userDataDir, tokenFile: tokenFilePath(deps), endpointFile: endpointFilePath(deps) };
}

function serverDeps(userDataDir: string, fsImpl: HostFs = fs): HostServerDeps {
  const deps = { platform: process.platform, userDataDir, xdgRuntimeDir: undefined };
  return {
    endpoint: resolveHostEndpoint(deps), platform: process.platform, tokenFile: tokenFilePath(deps), endpointFile: endpointFilePath(deps), modeFile: modeFilePath(deps), mode: 'headless', token: TOKEN, fs: fsImpl,
    getuid: process.getuid?.bind(process),
    connection: { sessions: fakeSessions(), hostVersion: '0.1.3', log: vi.fn(), newId: () => 'sub', setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } },
  };
}

// Conecta, envía las líneas y espera a que lleguen `expected` respuestas (o a que el servidor cierre).
function converse(address: string, messages: readonly unknown[], expected: number): Promise<Record<string, any>[]> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    const lines: Record<string, any>[] = [];
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) if (part.length > 0) lines.push(JSON.parse(part) as Record<string, any>);
      if (lines.length >= expected) socket.end();
    });
    socket.on('close', () => resolve(lines));
    socket.on('error', reject);
    socket.on('connect', () => { for (const message of messages) socket.write(`${JSON.stringify(message)}\n`); });
  });
}

const hello = { jsonrpc: '2.0', id: 1, method: 'hello', params: { protocol: HOST_PROTOCOL, client: { kind: 'terminal', version: 't' }, token: TOKEN } };

describe('startHostServer', () => {
  it('hello_yListarSesiones_respondenPorElTransporteReal', async () => {
    const { endpoint } = await start();

    const lines = await converse(endpoint.address, [hello, { jsonrpc: '2.0', id: 2, method: 'sessions.list' }], 2);

    expect(lines[0]!.result.protocol).toBe(HOST_PROTOCOL);
    expect(lines[1]!.result).toEqual({ sessions: [SNAPSHOT] });
  });

  it('hello_tokenMalo_respondeErrorYCierraLaConexion', async () => {
    const { endpoint } = await start();

    const lines = await converse(endpoint.address, [{ ...hello, params: { ...hello.params, token: 'd'.repeat(64) } }], 1);

    expect(lines[0]!.error.code).toBe(HostErrorCode.BadToken);
  });

  it('hello_jsonInvalido_cierraSinTumbarElServidor', async () => {
    const { endpoint } = await start();
    await new Promise<void>((resolve) => { const s = net.createConnection(endpoint.address, () => { s.write('{roto\n'); }); s.on('close', () => resolve()); s.resume(); });

    const lines = await converse(endpoint.address, [hello], 1);

    expect(lines[0]!.result).toBeDefined();
  });

  it('start_dejaLaDireccionParaLosClientesLocales', async () => {
    const { endpoint, endpointFile } = await start();

    expect(fs.readFileSync(endpointFile, 'utf8')).toBe(endpoint.address);
  });

  it('start_dejaDichoConQueModoArranco', async () => {
    await start();

    expect(fs.readFileSync(modeFilePath({ platform: process.platform, userDataDir: roots[0]!, xdgRuntimeDir: undefined }), 'utf8')).toBe('headless');
  });

  it('close_sacaElTokenYLaDireccionDelDisco', async () => {
    const { tokenFile, endpointFile } = await start();
    expect(fs.existsSync(tokenFile)).toBe(true);

    await handles.pop()!.close();

    expect(fs.existsSync(tokenFile)).toBe(false);
    expect(fs.existsSync(endpointFile)).toBe(false);
  });

  it('closeFilesSync_antesDeQueTermineElCierre_losFicherosYaNoEstan', async () => {
    const { tokenFile } = await start();

    handles[0]!.closeFilesSync();

    expect(fs.existsSync(tokenFile)).toBe(false);
  });

  it('start_direccionOcupada_rechazaYNoDejaTokenNiDireccionNiModo', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-host-'));
    roots.push(userDataDir);
    const deps = serverDeps(userDataDir, {
      ...fs,
      // En Unix el arranque borra un socket viejo antes de escuchar: se respeta el del ocupante para que listen falle.
      rmSync: (target, options) => { if (target !== resolveHostEndpoint({ platform: process.platform, userDataDir, xdgRuntimeDir: undefined }).address) fs.rmSync(target, options); },
    });
    if (deps.endpoint.directory !== null) fs.mkdirSync(deps.endpoint.directory, { recursive: true, mode: 0o700 });
    const squatter = net.createServer();
    await new Promise<void>((resolve) => { squatter.listen(deps.endpoint.address, resolve); });

    await expect(startHostServer(deps)).rejects.toThrow();

    await new Promise<void>((resolve) => { squatter.close(() => resolve()); });
    expect([deps.tokenFile, deps.endpointFile, deps.modeFile].filter((file) => fs.existsSync(file))).toEqual([]);
  });

  posixOnly('start_fichero_token0600_directorio0700_socket0600', async () => {
    const { endpoint, tokenFile } = await start();

    expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(tokenFile, 'utf8')).toBe(TOKEN);
    expect(fs.statSync(path.dirname(endpoint.address)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(endpoint.address).mode & 0o777).toBe(0o600);
  });

  posixOnly('start_directorioPropioConModoAncho_loCorrigeA0700', async () => {
    const { endpoint } = await start((userData) => { fs.mkdirSync(path.join(userData, 'run'), { mode: 0o755 }); });

    expect(fs.statSync(path.dirname(endpoint.address)).mode & 0o777).toBe(0o700);
  });

  posixOnly('start_socketDeUnaEjecucionAnterior_loSustituye', async () => {
    const { endpoint } = await start((userData) => { fs.mkdirSync(path.join(userData, 'run'), { mode: 0o700 }); fs.writeFileSync(resolveHostEndpoint({ platform: process.platform, userDataDir: userData, xdgRuntimeDir: undefined }).address, 'viejo'); });

    const lines = await converse(endpoint.address, [hello], 1);

    expect(lines[0]!.result).toBeDefined();
  });
});
