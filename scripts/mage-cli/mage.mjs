#!/usr/bin/env node
// Cliente de terminal de Mage (F7.3): `mage chat` se une a una sesión del host local, o la crea, y conversa con
// ella por la terminal. Este fichero solo cablea E/S real (readline, señales, sockets); la lógica vive en los
// módulos puros de esta carpeta. Sin dependencias: solo `node:*` (lo ejecuta el Electron de la app en modo Node).
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import readline from 'node:readline';
import { parseChatArgs, defaultUserDataDir } from './chatArgs.mjs';
import { ChatController } from './chatController.mjs';
import { connectVerified } from './hostLink.mjs';
import { installMute } from './hiddenInput.mjs';
import { createMessages, pickLanguage } from './messages.mjs';
import { reconnectWithRetries } from './reconnect.mjs';
import { resolveTarget } from './targetPicker.mjs';

const EXIT_ERROR = 1;
const EXIT_BAD_ARGUMENTS = 2;
const CLIENT_VERSION = 'mage-chat';

function connectSocket(address) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

const linkDeps = {
  platform: process.platform,
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  lstat: fs.lstatSync,
  getuid: process.getuid?.bind(process) ?? (() => -1),
  connect: connectSocket,
  randomBytes,
};

const writeOut = (text) => process.stdout.write(text);

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(error?.exitCode ?? EXIT_ERROR);
}

function parseArgsOrExit() {
  try {
    return parseChatArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return process.exit(EXIT_BAD_ARGUMENTS);
  }
}

// Pregunta por readline; si la entrada se cierra (Ctrl+D) con la pregunta pendiente, rechaza.
function createAsk(rl) {
  return (prompt) => new Promise((resolve, reject) => {
    const onClose = () => reject(new Error('Entrada cerrada antes de elegir'));
    rl.once('close', onClose);
    rl.question(`${prompt} `, (answer) => {
      rl.off('close', onClose);
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgsOrExit();
  const messages = createMessages(pickLanguage({ env: process.env, intlLocale: Intl.DateTimeFormat().resolvedOptions().locale }));
  const userDataDir = args.userDataDir ?? defaultUserDataDir({ platform: process.platform, env: process.env, homedir: os.homedir() });
  const connect = () => connectVerified({ userDataDir, clientVersion: CLIENT_VERSION, deps: linkDeps });

  const link = await connect();
  const info = await link.rpc.call('host.info');
  writeOut(`${messages.connected(link.hello.hostVersion, info.mode)}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  const setMuted = installMute(rl);
  const sessionId = await resolveTarget({
    rpc: link.rpc, target: args.target, cwd: process.cwd(), ask: createAsk(rl), write: writeOut, messages, newCommandId: randomUUID,
  });

  let controller;
  const watchSocket = (current) => current.socket.once('close', () => guardPromise(controller.onDisconnected()));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const reconnect = async () => {
    const next = await reconnectWithRetries({ connect, sleep, onAttempt: (n, ms) => writeOut(`${messages.retrying(n, ms)}\n`) });
    watchSocket(next);
    return next;
  };
  const exit = (code) => {
    rl.removeAllListeners('close');
    rl.close();
    controller.link.rpc.close();
    process.exit(code);
  };
  controller = new ChatController({ link, sessionId, messages, write: writeOut, now: Date.now, exit, reconnect, setMuted });
  watchSocket(link);

  rl.on('line', (text) => guardPromise(controller.onLine(text)));
  rl.on('SIGINT', () => guardPromise(controller.onCtrlC()));
  rl.on('close', () => controller.onEndOfInput());
  for (const signal of ['SIGHUP', 'SIGTERM']) process.on(signal, () => controller.onKilled());
  await controller.attach();
}

// Toda promesa rechazada sin tratar acaba en stderr con código de salida (nada de `catch` vacío).
function guardPromise(promise) {
  promise.catch(fail);
}

process.on('unhandledRejection', fail);
main().catch(fail);
