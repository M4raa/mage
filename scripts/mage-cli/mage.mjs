#!/usr/bin/env node
// Comando `mage` de Mage (F7): `chat`, `stop`, `account add` y la ayuda. Este fichero solo cablea E/S real
// (readline, señales, sockets, el arranque de Mage sin ventanas); la lógica vive en los módulos puros de esta
// carpeta. Sin dependencias: solo `node:*` (lo ejecuta el Electron de la app en modo Node).
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import readline from 'node:readline';
import { defaultUserDataDir } from './chatArgs.mjs';
import { ChatController } from './chatController.mjs';
import { parseCliArgs } from './cliArgs.mjs';
import { runAccountAdd, runStop } from './commands.mjs';
import { connectVerified } from './hostLink.mjs';
import { ensureHost, headlessLaunch, isNoHostError } from './hostStarter.mjs';
import { installMute } from './hiddenInput.mjs';
import { createMessages, pickLanguage } from './messages.mjs';
import { reconnectWithRetries } from './reconnect.mjs';
import { decidePermissionAnswer } from './signals.mjs';
import { resolveTarget } from './targetPicker.mjs';

const EXIT_OK = 0;
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
const writeLine = (text) => writeOut(`${text}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(error?.exitCode ?? EXIT_ERROR);
}

function parseArgsOrExit() {
  try {
    return parseCliArgs(process.argv.slice(2));
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

// Contexto común de todos los comandos: idioma y cómo conectar o arrancar Mage sin ventanas.
function createContext(args) {
  const messages = createMessages(pickLanguage({ env: process.env, intlLocale: Intl.DateTimeFormat().resolvedOptions().locale }));
  const defaultDir = defaultUserDataDir({ platform: process.platform, env: process.env, homedir: os.homedir() });
  const userDataDir = args.userDataDir ?? defaultDir;
  const connect = () => connectVerified({ userDataDir, clientVersion: CLIENT_VERSION, deps: linkDeps });
  const launch = () => {
    const plan = headlessLaunch({
      platform: process.platform, execPath: process.execPath, isElectron: process.versions.electron !== undefined,
      env: process.env, userDataDir, defaultUserDataDir: defaultDir,
    });
    spawn(plan.command, plan.args, { env: plan.env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  };
  return { messages, connect, launch };
}

// Encuentra el host (o arranca Mage sin ventanas y lo cuenta); con `allowStart: false` solo conecta.
async function findHost(ctx, allowStart) {
  const { messages } = ctx;
  const { link, started } = await ensureHost({
    connect: ctx.connect, launch: ctx.launch, sleep, now: Date.now, allowStart,
    onStarting: () => writeLine(messages.startingHeadless()),
  });
  if (started) writeLine(messages.startedHeadless());
  return link;
}

async function runChat(args, ctx) {
  const { messages, connect } = ctx;
  const link = await findHost(ctx, true);
  const info = await link.rpc.call('host.info');
  writeLine(messages.connected(link.hello.hostVersion, info.mode));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  const setMuted = installMute(rl);
  const sessionId = await resolveTarget({
    rpc: link.rpc, target: args.target, cwd: process.cwd(), ask: createAsk(rl), write: writeOut, messages, newCommandId: randomUUID,
  });

  let controller;
  const watchSocket = (current) => current.socket.once('close', () => guardPromise(controller.onDisconnected()));
  const reconnect = async () => {
    const next = await reconnectWithRetries({ connect, sleep, onAttempt: (n, ms) => writeLine(messages.retrying(n, ms)) });
    watchSocket(next);
    return next;
  };
  const exit = (code) => {
    rl.removeAllListeners('close');
    rl.close();
    controller.link.rpc.close();
    process.exit(code);
  };
  controller = new ChatController({ link, sessionId, messages, write: writeOut, now: Date.now, exit, reconnect, setMuted, prefill: (text) => rl.write(text) });
  watchSocket(link);

  rl.on('line', (text) => guardPromise(controller.onLine(text)));
  rl.on('SIGINT', () => guardPromise(controller.onCtrlC()));
  rl.on('close', () => controller.onEndOfInput());
  for (const signal of ['SIGHUP', 'SIGTERM']) process.on(signal, () => controller.onKilled());
  await controller.attach();
}

// Sin terminal interactiva no hay a quién preguntar: `null`. Con ella, `s`/`y` confirma y todo lo demás niega.
function createConfirm() {
  if (!process.stdin.isTTY) return null;
  return async (prompt) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    try {
      const answer = await createAsk(rl)(prompt);
      return decidePermissionAnswer(answer) === 'allow';
    } finally {
      rl.close();
    }
  };
}

async function runStopCommand(args, ctx) {
  const { messages } = ctx;
  let link;
  try {
    link = await findHost(ctx, false);
  } catch (error) {
    if (!isNoHostError(error)) throw error;
    writeLine(messages.nothingToStop());
    process.exit(EXIT_OK);
  }
  const code = await runStop({ rpc: link.rpc, force: args.force, confirm: createConfirm(), write: writeLine, messages });
  link.rpc.close();
  process.exit(code);
}

// Con terminal: una línea sin eco.
async function readKeyFromTerminal(messages) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const setMuted = installMute(rl);
  try {
    writeOut(`${messages.accountKeyPrompt()} `);
    setMuted(true);
    return await new Promise((resolve, reject) => {
      rl.once('line', resolve);
      rl.once('close', () => reject(new Error('Entrada cerrada antes de recibir la clave')));
    });
  } finally {
    setMuted(false);
    rl.removeAllListeners('close');
    rl.close();
    writeOut('\n');
  }
}

// Sin terminal (tubería): primera línea de toda la entrada estándar.
async function readKeyFromPipe() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
}

const readKey = (messages) => (process.stdin.isTTY ? readKeyFromTerminal(messages) : readKeyFromPipe());

async function runAccountAddCommand(args, ctx) {
  const { messages } = ctx;
  const link = await findHost(ctx, true);
  const code = await runAccountAdd({
    rpc: link.rpc, provider: args.provider, name: args.name, readKey: () => readKey(messages), write: writeLine, messages,
  });
  link.rpc.close();
  process.exit(code);
}

const COMMANDS = { chat: runChat, stop: runStopCommand, accountAdd: runAccountAddCommand };

async function main() {
  const args = parseArgsOrExit();
  const ctx = createContext(args);
  if (args.command === 'help') {
    writeLine(ctx.messages.help());
    process.exit(EXIT_OK);
  }
  await COMMANDS[args.command](args, ctx);
}

// Toda promesa rechazada sin tratar acaba en stderr con código de salida (nada de `catch` vacío).
function guardPromise(promise) {
  promise.catch(fail);
}

process.on('unhandledRejection', fail);
main().catch(fail);
