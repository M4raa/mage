import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import { agyLinkedPaths, toAgyPermissionRules } from '@shared/agyRules';
import { defaultLinkDeps, LinkService } from '../os/linkService';
import { AgentSession } from './agentSession';
import { AgyAdapter } from './agyAdapter';
import { agyProfileSettings, writeAgyProfileSettings, type AgyProfileMode } from './agyProfile';
import { linkAgyProfile } from './agyProfileLinks';

// Integracion contra el CLI REAL de agy (consume suscripcion: 3 turnos cortos con el modelo mas barato).
// No corre en `pnpm test`; solo con MAGE_E2E_AGY=1. Recorre el motor de produccion (AgyAdapter +
// AgentSession) en sesion persistente y con el PERFIL PROPIO de la suscripcion (grupo E, fase 2): un
// turno que ejecuta un comando permitido por regla exacta, interrumpir otro a mitad (corte del arbol) y
// un tercero que relanza con `--conversation` y conserva el contexto; con una imagen adjunta por ruta.
// La casa que se enlaza es FALSA (temporal): la config real de agy no se toca (hash antes y despues).
const RUN = process.env.MAGE_E2E_AGY === '1';
const MODEL = 'gemini-3.8-flash-low';
const TURN_TIMEOUT_MS = 180_000;
const ALLOWED_COMMAND = 'echo plum > plum.txt';
// PNG de 1x1 rojo.
const RED_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

// Medido: agy deja un proceso suyo con la carpeta abierta un rato despues de morir la sesion (EPERM al
// borrarla). Es del temporal del SO: si no se puede borrar ya, se avisa y se deja.
function removeLater(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (err) {
    console.warn(`No se pudo borrar ${dir} todavia (${err instanceof Error ? err.message : String(err)}): queda en el temporal`);
  }
}

// Huella de la config REAL de agy (settings del CLI y ~/.gemini/config).
function realConfigFingerprint(): string {
  const hashes: string[] = [];
  const walk = (target: string): void => {
    if (!existsSync(target)) return;
    if (statSync(target).isDirectory()) {
      for (const entry of readdirSync(target)) walk(join(target, entry));
      return;
    }
    hashes.push(`${target}:${createHash('sha256').update(readFileSync(target)).digest('hex')}`);
  };
  [join(homedir(), '.gemini', 'antigravity-cli', 'settings.json'), join(homedir(), '.gemini', 'config')].forEach(walk);
  return createHash('sha256').update(hashes.sort().join('\n')).digest('hex');
}

// Lo mismo que hace main (prepareAgyProfile en index.ts) con una casa falsa.
function prepareProfile(fakeHome: string, attachmentsDir: string) {
  const links = new LinkService(defaultLinkDeps((level, message) => console.warn(`[${level}] ${message}`)));
  return (profileDir: string, cwd: string, mode: AgyProfileMode): void => {
    mkdirSync(profileDir, { recursive: true });
    const profile = realpathSync.native(profileDir);
    linkAgyProfile(
      {
        links,
        isDirectory: (path) => existsSync(path) && statSync(path).isDirectory(),
        mkdir: (path) => mkdirSync(path, { recursive: true }),
        rename: renameSync,
        readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
        writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
        now: () => Date.now(),
        log: (level, message) => console.warn(`[${level}] ${message}`),
      },
      { profileDir: profile, home: fakeHome, paths: agyLinkedPaths([], process.platform === 'win32') },
    );
    const extra = toAgyPermissionRules({ allow: [ALLOWED_COMMAND], deny: [] });
    const settings = agyProfileSettings({ mode, profileDir: profile, cwd: realpathSync.native(cwd), attachmentsDir, extra });
    writeAgyProfileSettings({ mkdir: (path) => mkdirSync(path, { recursive: true }), writeFile: (path, text) => writeFileSync(path, text, 'utf8') }, profile, settings);
  };
}

describe('AgentSession + AgyAdapter (integracion, agy real)', () => {
  it.skipIf(!RUN)(
    'sesionPersistente_perfilDeSuscripcion_reglaCorteYReanudacionConservanElContexto',
    async () => {
      const before = realConfigFingerprint();
      const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-agy-e2e-')));
      const cwd = join(root, 'ws');
      const fakeHome = join(root, 'home');
      const attachmentsDir = join(root, 'adjuntos');
      const profileDir = join(root, 'agy-profile');
      [cwd, join(fakeHome, '.gemini', 'config'), attachmentsDir].forEach((dir) => mkdirSync(dir, { recursive: true }));
      const events: MageEvent[] = [];
      let waiter: { count: number; resolve: () => void } | null = null;
      const results = (): number => events.filter((e) => e.kind === 'result').length;
      const waitResults = (count: number): Promise<void> =>
        new Promise((resolve) => {
          if (results() >= count) resolve();
          else waiter = { count, resolve };
        });
      const session = new AgentSession({
        adapter: new AgyAdapter({
          resolveApiAccount: () => null,
          subscriptionProfileDir: () => profileDir,
          prepareProfile: prepareProfile(fakeHome, attachmentsDir),
          saveAttachment: (_s, attachment) => {
            const path = join(attachmentsDir, `img-${Date.now()}.png`);
            writeFileSync(path, Buffer.from(attachment.data, 'base64'));
            return path;
          },
        }),
        params: { sessionId: 'e2e', accountDir: '', model: MODEL, cwd },
        emit: (event) => {
          events.push(event);
          if (waiter !== null && results() >= waiter.count) waiter.resolve();
        },
      });
      try {
        session.start();
        session.sendUserMessage(`Remember the word PLUM. Use the run_command tool to run exactly this command and nothing else: ${ALLOWED_COMMAND}. Then reply with exactly: OK`);
        await waitResults(1);
        session.sendUserMessage('Count from 1 to 300, one number per line, no other text.');
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        session.interrupt();
        await waitResults(2);
        session.sendUserMessage('What word did I ask you to remember, and what color is [Imagen 1]? Two words.', [{ mediaType: 'image/png', data: RED_PIXEL_PNG }]);
        await waitResults(3);

        const text = events.flatMap((e) => (e.kind === 'stream_delta' ? [e.text] : [])).join('');
        const interrupted = events.filter((e) => e.kind === 'result')[1];
        expect(interrupted).toMatchObject({ result: { subtype: 'interrupted' } });
        expect(existsSync(join(cwd, 'plum.txt'))).toBe(true); // regla exacta del perfil
        expect(text.toUpperCase()).toContain('PLUM');
        expect(text.toLowerCase()).toContain('red');
        expect(events.filter((e) => e.kind === 'session_init').length).toBe(2); // dos procesos, la misma conversacion
        expectUsagePerTurn(events);
        expect(readdirSync(join(profileDir, '.gemini', 'antigravity-cli', 'conversations')).length).toBeGreaterThan(0); // en el perfil, no en el real
        expect(new LinkService(defaultLinkDeps(() => undefined)).classifyLink(join(profileDir, '.gemini', 'config'))).toBe('link');
        expect(realConfigFingerprint()).toBe(before);
      } finally {
        session.stop();
        removeLater(root);
      }
    },
    TURN_TIMEOUT_MS * 3,
  );
});

// Cada turno terminado trae su uso (restado del acumulado del proceso por AgyTurnTracker).
function expectUsagePerTurn(events: readonly MageEvent[]): void {
  const done = events.flatMap((e) => (e.kind === 'result' && e.result.subtype !== 'interrupted' ? [e.result] : []));
  for (const result of done) expect(result.usage?.inputTokens ?? 0).toBeGreaterThan(0);
}
