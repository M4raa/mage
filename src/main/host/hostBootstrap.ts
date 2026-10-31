import { randomBytes } from 'node:crypto';
import type { Translate } from '@shared/i18n/translator';
import type { SessionLogFn } from '../engine/agentSession';
import type { HostSessions } from './hostConnection';
import { endpointFilePath, modeFilePath, resolveHostEndpoint, tokenFilePath, type HostEndpointDeps } from './hostEndpoint';
import { startHostServer, type HostFs, type HostMode, type HostServerHandle } from './hostServer';
import { createHostToken } from './hostToken';

// Arranque del host local (F2.6): junta dirección, token, ficheros y servidor con lo que da Electron. Lo usa
// `index.ts` en los dos modos (con pantalla y sin ella).

export interface HostBootstrapDeps {
  readonly platform: NodeJS.Platform;
  readonly userDataDir: string;
  readonly xdgRuntimeDir: string | undefined;
  readonly mode: HostMode;
  readonly fs: HostFs;
  readonly getuid: (() => number) | undefined;
  readonly sessions: HostSessions;
  readonly hostVersion: string;
  readonly log: SessionLogFn;
  readonly newId: () => string;
  readonly setTimer: (fn: () => void, ms: number) => () => void;
  readonly translate: Translate;
  // Aleatorios del sistema: inyectable para probar.
  readonly randomBytes?: (size: number) => Buffer;
}

// Un token NUEVO en cada arranque. Nunca va a `process.env` ni a un log: solo al fichero y a la memoria del host.
export async function startLocalHost(deps: HostBootstrapDeps): Promise<HostServerHandle> {
  const where: HostEndpointDeps = { platform: deps.platform, userDataDir: deps.userDataDir, xdgRuntimeDir: deps.xdgRuntimeDir };
  const endpoint = resolveHostEndpoint(where);
  const handle = await startHostServer({
    endpoint,
    platform: deps.platform,
    tokenFile: tokenFilePath(where),
    endpointFile: endpointFilePath(where),
    modeFile: modeFilePath(where),
    mode: deps.mode,
    token: createHostToken({ randomBytes: deps.randomBytes ?? randomBytes }),
    fs: deps.fs,
    getuid: deps.getuid,
    connection: { sessions: deps.sessions, hostVersion: deps.hostVersion, log: deps.log, newId: deps.newId, setTimer: deps.setTimer, translate: deps.translate },
  });
  deps.log('info', 'Host local escuchando', { kind: endpoint.kind, mode: deps.mode });
  return handle;
}

// Con qué modo corre el host que tiene el lock del perfil, o null si no hay marca (o no se entiende): la lee la
// segunda instancia que perdió el lock para decir si la interfaz gráfica es posible.
export function readHostMode(deps: { readonly platform: NodeJS.Platform; readonly userDataDir: string; readonly readFile: (path: string) => string | null }): HostMode | null {
  const value = deps.readFile(modeFilePath({ platform: deps.platform, userDataDir: deps.userDataDir, xdgRuntimeDir: undefined }));
  return value === 'gui' || value === 'headless' ? value : null;
}
