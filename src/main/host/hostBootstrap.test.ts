import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@shared/i18n/translator';
import { scrubAgentEnv } from '../os/agentEnv';
import type { HostSessions } from './hostConnection';
import type { HostControl } from './hostControl';
import { readHostMode, startLocalHost } from './hostBootstrap';
import { tokenFilePath } from './hostEndpoint';
import type { HostServerHandle } from './hostServer';

const roots: string[] = [];
const handles: HostServerHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const sessions = (): HostSessions => ({
  listSessions: () => [], snapshot: () => { throw new Error('Sesion inexistente: x'); }, subscribe: () => { throw new Error('no'); },
  send: () => ({ status: 'accepted', commandId: 'k' }), interrupt: () => [], removeQueued: () => null, updateQueued: () => null, answerPermission: () => ({ status: 'accepted' }), answerElicitation: () => ({ status: 'accepted' }),
});

async function start(mode: 'gui' | 'headless' = 'gui', log = vi.fn()) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-boot-'));
  roots.push(userDataDir);
  const handle = await startLocalHost({
    platform: process.platform, userDataDir, xdgRuntimeDir: undefined, mode, fs, getuid: process.getuid?.bind(process),
    sessions: sessions(), control: { createSession: vi.fn(), setOption: vi.fn(), listProjects: () => [], listAccounts: () => [] } as HostControl, hostVersion: '0.1.3', log, newId: () => 'id', translate: createTranslator('es'), setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  });
  handles.push(handle);
  return { userDataDir, handle };
}

describe('startLocalHost', () => {
  it('startLocalHost_arranque_dejaUnTokenDe64HexEnSuFichero', async () => {
    const { userDataDir } = await start();

    const token = fs.readFileSync(tokenFilePath({ platform: process.platform, userDataDir, xdgRuntimeDir: undefined }), 'utf8');

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('startLocalHost_dosArranques_tokenDistintoCadaVez', async () => {
    const first = await start();
    const second = await start();

    const read = (userDataDir: string) => fs.readFileSync(tokenFilePath({ platform: process.platform, userDataDir, xdgRuntimeDir: undefined }), 'utf8');

    expect(read(first.userDataDir)).not.toBe(read(second.userDataDir));
  });

  it('startLocalHost_elToken_nuncaLlegaAlEntornoNiAUnHijoNiAlLog', async () => {
    const before = JSON.stringify(process.env);
    const log = vi.fn();
    const { userDataDir } = await start('gui', log);
    const token = fs.readFileSync(tokenFilePath({ platform: process.platform, userDataDir, xdgRuntimeDir: undefined }), 'utf8');

    expect(JSON.stringify(process.env)).toBe(before);
    expect(JSON.stringify(scrubAgentEnv(process.env))).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it('startLocalHost_elToken_noApareceEnElRendererNiEnElPreload', () => {
    const roots = [path.resolve(__dirname, '../../renderer'), path.resolve(__dirname, '../../preload')];
    const hits: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(ts|tsx|mjs)$/.test(entry.name) && /host-token|HostToken|tokenFilePath|hostBootstrap/.test(fs.readFileSync(full, 'utf8'))) hits.push(full);
      }
    };
    for (const root of roots) visit(root);

    expect(hits).toEqual([]);
  });

  it('startLocalHost_modo_quedaDichoParaLaSegundaInstancia', async () => {
    const { userDataDir } = await start('headless');

    const mode = readHostMode({ platform: process.platform, userDataDir, readFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) });

    expect(mode).toBe('headless');
  });
});

describe('readHostMode', () => {
  const read = (value: string | null) => readHostMode({ platform: 'linux', userDataDir: '/u', readFile: () => value });

  it('readHostMode_guiYHeadless_loDevuelve', () => {
    expect(read('gui')).toBe('gui');
    expect(read('headless')).toBe('headless');
  });

  it('readHostMode_sinMarcaOContenidoRaro_null', () => {
    expect(read(null)).toBeNull();
    expect(read('otra cosa')).toBeNull();
    expect(read('')).toBeNull();
  });
});
