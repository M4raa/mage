// Frontera IPC del navegador: valida con Zod lo que manda el panel y delega. Solo atiende a una ventana de trabajo de Mage (D-S8).
import { z } from 'zod';
import { IpcChannel } from '@shared/ipc';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import { describeIssues } from '../capabilities/capabilityPackage';
import { BrowserControlError, type BrowserRegistry } from './browserRegistry';
import { parseStrokes } from './captureAnnotation';
import { PenCaptureExpiredError, type PenSessions } from './penSession';
import type { PlacementWindow, ViewPlacement } from './viewPlacement';

export interface BrowserIpcDeps {
  readonly handle: (
    channel: string,
    listener: (event: { readonly sender: { readonly id: number } }, arg: unknown) => unknown,
  ) => void;
  readonly registry: BrowserRegistry;
  readonly placement: ViewPlacement;
  readonly pens: PenSessions;
  readonly windowOf: (webContentsId: number) => PlacementWindow | null;
}

const MAX_SESSION_ID_CHARS = 200;
const MAX_URL_CHARS = 2048;
const MAX_CAPTURE_ID_CHARS = 100;
const MAX_BOUNDS_VALUE = 100_000;
const MAX_PREVIEW_CHARS = 200;

const sessionIdSchema = z.string().min(1).max(MAX_SESSION_ID_CHARS);
const boundsValueSchema = z.number().int().min(0).max(MAX_BOUNDS_VALUE);
const navigateSchema = z.object({ sessionId: sessionIdSchema, url: z.string().min(1).max(MAX_URL_CHARS) }).strict();
const boundsSchema = z
  .object({
    sessionId: sessionIdSchema,
    bounds: z
      .object({ x: boundsValueSchema, y: boundsValueSchema, width: boundsValueSchema, height: boundsValueSchema })
      .strict()
      .nullable(),
  })
  .strict();
// Los trazos se validan aparte con `parseStrokes` (S01), que ya conoce sus límites.
const composeSchema = z
  .object({ sessionId: sessionIdSchema, captureId: z.string().min(1).max(MAX_CAPTURE_ID_CHARS), strokes: z.unknown() })
  .strict();

function previewValue(raw: unknown): string {
  const text = JSON.stringify(raw) ?? String(raw);
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}…` : text;
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Petición del navegador inválida (${describeIssues(result.error)}): ${previewValue(raw)}`);
}

// Los errores que el usuario puede provocar desde el panel salen como texto de Mage; el resto se relanza tal cual.
function toUserFacing(error: unknown): unknown {
  if (error instanceof PenCaptureExpiredError) return new UserFacingError(localized('errors.browser.penCaptureExpired'));
  if (!(error instanceof BrowserControlError)) return error;
  if (error.code === 'session_not_live') return new UserFacingError(localized('errors.browser.sessionNotLive'));
  if (error.code === 'browser_not_open') return new UserFacingError(localized('errors.browser.browserNotOpen'));
  return error;
}

function requireWindow(deps: BrowserIpcDeps, webContentsId: number): PlacementWindow {
  const window = deps.windowOf(webContentsId);
  if (window === null) {
    throw new Error(`Petición del navegador desde un webContents que no es una ventana de Mage: ${webContentsId}`);
  }
  return window;
}

async function navigateAsUser(deps: BrowserIpcDeps, sessionId: string, url: string): Promise<void> {
  const handle = deps.registry.beginUserAction(sessionId);
  try {
    await handle.navigate(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UserFacingError(localized('errors.browser.navigateFailed', { url, detail }));
  }
}

function setBounds(deps: BrowserIpcDeps, window: PlacementWindow, raw: unknown): void {
  const { sessionId, bounds } = parseWith(boundsSchema, raw);
  // El panel puede informar de su hueco antes de que exista el navegador.
  const handle = deps.registry.get(sessionId);
  if (handle === null) return;
  if (bounds === null) deps.placement.hide(handle);
  else deps.placement.show(handle, window, bounds);
}

export function registerBrowserIpc(deps: BrowserIpcDeps): void {
  const { registry, pens } = deps;
  const route = (channel: string, run: (arg: unknown, window: PlacementWindow) => unknown): void => {
    deps.handle(channel, async (event, arg) => {
      try {
        return await run(arg, requireWindow(deps, event.sender.id));
      } catch (error) {
        throw toUserFacing(error);
      }
    });
  };
  const bySession = (channel: string, run: (sessionId: string) => unknown): void =>
    route(channel, (arg) => run(parseWith(sessionIdSchema, arg)));

  route(IpcChannel.BrowserList, () => registry.states());
  bySession(IpcChannel.BrowserOpen, (sessionId) => {
    registry.beginUserAction(sessionId);
    return registry.states();
  });
  route(IpcChannel.BrowserNavigate, (arg) => {
    const { sessionId, url } = parseWith(navigateSchema, arg);
    return navigateAsUser(deps, sessionId, url);
  });
  bySession(IpcChannel.BrowserBack, (sessionId) => void registry.beginUserAction(sessionId).back());
  bySession(IpcChannel.BrowserReload, (sessionId) => registry.beginUserAction(sessionId).reload());
  bySession(IpcChannel.BrowserClose, async (sessionId) => void (await registry.close(sessionId)));
  route(IpcChannel.BrowserSetBounds, (arg, window) => setBounds(deps, window, arg));
  bySession(IpcChannel.BrowserTakeControl, (sessionId) => registry.takeControl(sessionId));
  bySession(IpcChannel.BrowserReturnControl, (sessionId) => registry.returnControl(sessionId));
  bySession(IpcChannel.BrowserPenCapture, (sessionId) => pens.capture(sessionId));
  route(IpcChannel.BrowserPenCompose, (arg) => {
    const { sessionId, captureId, strokes } = parseWith(composeSchema, arg);
    return pens.compose(sessionId, captureId, parseStrokes(strokes));
  });
}
