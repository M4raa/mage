import { withGuiState } from './guiState.mjs';

const STATE_TIMEOUT_MS = 10_000;
const STATE_POLL_MS = 50;

// El snapshot viaja por CDP; las acciones se quedan en el renderer para recuperar tambien stubs.
// Set/Map no sobreviven a la serializacion habitual de Playwright.
export function encodeGuiState(value) {
  return JSON.stringify(value, (_, item) => {
    if (item instanceof Set) return { __guiSet: [...item] };
    if (item instanceof Map) return { __guiMap: [...item] };
    return item;
  });
}

export function decodeGuiState(value) {
  return JSON.parse(value, (_, item) => {
    if (item?.__guiSet !== undefined) return new Set(item.__guiSet);
    if (item?.__guiMap !== undefined) return new Map(item.__guiMap);
    return item;
  });
}

// Un fixture puede escribir un sessionId sin crear una sesion; una real puede haberse cerrado ya.
// Solo esa ausencia es idempotente. Un fallo de IPC o de stop sigue siendo un fallo de limpieza.
export async function stopGuiSession(stop, sessionId) {
  try { await stop(sessionId); }
  catch (error) {
    if (!String(error?.message ?? error).endsWith(`Sesion inexistente: ${sessionId}`)) throw error;
  }
}

export async function runGuiCheck({ page, check, context, prepare, settle }) {
  return withGuiState({
    capture: () => captureCheckState(page),
    prepare: () => prepare(check),
    run: async () => {
      const outcome = await check.run(page, context);
      // La captura pertenece al caso, antes de devolver la ventana al estado anterior.
      await page.screenshot({ path: context.screenshot });
      return outcome;
    },
    restore: (previous) => restoreCheckState(page, previous, settle),
  });
}

async function captureCheckState(page) {
  const settings = await page.evaluate(() => ({
    section: document.querySelector('#settings-title')?.closest('[role="dialog"]')?.querySelector('nav [aria-selected="true"]')?.id ?? null,
    mcpTab: document.querySelector('[data-mcp-tab][aria-selected="true"]')?.getAttribute('data-mcp-tab') ?? null,
  }));
  const data = await page.evaluate(`(() => {
    const dev = window.__mageDev;
    const stores = { store: dev.store, panels: dev.panelStore, notifications: dev.notifications, apps: dev.codexAppsStore };
    for (const tab of dev.store.getState().tabs) stores['transcript:' + tab.id] = dev.transcriptStoreFor(tab.id);
    const states = Object.fromEntries(Object.entries(stores).map(([key, store]) => [key, store.getState()]));
    window.__verifyGuiActions = Object.fromEntries(Object.entries(states).map(([key, state]) =>
      [key, Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value === 'function'))]));
    window.__verifyGuiFocus = document.activeElement;
    window.__verifyGuiTabs = new Set();
    window.__verifyGuiUnsubscribe = dev.store.subscribe((state) => {
      for (const tab of state.tabs) window.__verifyGuiTabs.add(tab.id);
    });
    const focusPath = [];
    for (let node = document.activeElement; node instanceof HTMLElement; node = node.parentElement) {
      if (node.id) { focusPath.unshift('#' + CSS.escape(node.id)); break; }
      const siblings = [...(node.parentElement?.children ?? [node])].filter((item) => item.tagName === node.tagName);
      focusPath.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    }
    return (${encodeGuiState.toString()})({ states, theme: document.documentElement.dataset.theme,
      focusSelector: focusPath.join(' > '), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      viewport: { width: innerWidth, height: innerHeight } });
  })()`);
  return { data, settings };
}

async function restoreCheckState(page, previous, settle) {
  await page.locator('[role="toolbar"]').first().waitFor({ state: 'attached' });
  await closeCheckOverlays(page);
  const snapshot = decodeGuiState(previous.data);
  await disposeCheckResources(page, snapshot.states.store);
  await page.setViewportSize(snapshot.viewport);
  await page.emulateMedia({ reducedMotion: snapshot.reducedMotion ? 'reduce' : 'no-preference' });
  await restoreRendererState(page, previous.data);
  if (snapshot.states.store.closePromptOpen) {
    // El dialogo de cierre tiene un dueño en main: recrear tambien su pregunta, no solo el booleano.
    await page.evaluate(() => window.close());
    await page.waitForFunction(() => window.__mageDev.store.getState().closePromptOpen,
      undefined, { polling: STATE_POLL_MS, timeout: STATE_TIMEOUT_MS });
  }
  await settle();
  await restoreDialogPosition(page, previous.settings);
  await page.evaluate((selector) => {
    const focus = window.__verifyGuiFocus?.isConnected ? window.__verifyGuiFocus : document.querySelector(selector);
    focus?.focus();
    delete window.__verifyGuiFocus;
    delete window.__verifyGuiActions;
  }, snapshot.focusSelector);
  // Restituye tambien el estado que lee main; las acciones persistentes tienen debounce propio.
  await page.evaluate((settings) => window.mage.saveSettings(settings), snapshot.states.store.settings);
  await page.evaluate((layout) => window.mage.savePanelLayout(layout), snapshot.states.panels.layout);
  await page.evaluate(() => {
    const dev = window.__mageDev;
    const state = dev.store.getState();
    return window.mage.saveWorkspace(dev.toPersistedWorkspace(state.tabs, state.activeTabId, state.sessionIdByChat, state.splitLayout));
  });
  await assertRestoredState(page, previous.data);
}

async function assertRestoredState(page, data) {
  const mismatches = await page.evaluate(`((data) => {
    const expected = JSON.parse(data).states;
    const dev = window.__mageDev;
    const encode = ${encodeGuiState.toString()};
    const store = dev.store.getState();
    const keys = ['tabs', 'activeTabId', 'activeAccountId', 'splitLayout', 'settings', 'closePromptOpen',
      ...Object.keys(expected.store).filter((key) => key.endsWith('ByChat'))];
    const mismatches = keys.filter((key) => encode(store[key]) !== JSON.stringify(expected.store[key]));
    if (encode(dev.panelStore.getState().layout) !== JSON.stringify(expected.panels.layout)) mismatches.push('panel.layout');
    for (const key of ['toasts', 'history']) {
      if (encode(dev.notifications.getState()[key]) !== JSON.stringify(expected.notifications[key])) mismatches.push('notifications.' + key);
    }
    return mismatches;
  })(${JSON.stringify(data)})`);
  if (mismatches.length > 0) throw new Error(`Estado GUI sin restaurar: ${mismatches.join(', ')}`);
}

async function disposeCheckResources(page, previous) {
  await page.evaluate(`(async (previous) => {
    const dev = window.__mageDev;
    window.__verifyGuiUnsubscribe?.();
    const current = dev.store.getState();
    const kept = new Set(previous.tabs.map((tab) => tab.id));
    const created = new Set([...(window.__verifyGuiTabs ?? []), ...current.tabs.map((tab) => tab.id)]);
    for (const id of created) {
      if (kept.has(id)) continue;
      const session = current.sessionIdByChat[id];
      if (session !== undefined) await (${stopGuiSession.toString()})((id) => window.mage.stop(id), session);
      dev.disposeTranscriptStore(id);
    }
    const providers = new Set(previous.settings.customProviders.map((provider) => provider.id));
    for (const provider of current.settings.customProviders) {
      if (!providers.has(provider.id)) await current.removeCustomProvider(provider.id);
    }
    delete window.__verifyGuiTabs;
    delete window.__verifyGuiUnsubscribe;
  })(${JSON.stringify(previous)})`);
}

async function restoreRendererState(page, data) {
  await page.evaluate(`((data) => {
    const snapshot = (${decodeGuiState.toString()})(data);
    const dev = window.__mageDev;
    const current = dev.store.getState();
    const settings = snapshot.states.store.settings;
    if (current.settings.uiScale !== settings.uiScale) current.setUiScale(settings.uiScale);
    if (current.settings.widgetEnabled !== settings.widgetEnabled) current.setWidgetEnabled(settings.widgetEnabled);
    const stores = { store: dev.store, panels: dev.panelStore, notifications: dev.notifications, apps: dev.codexAppsStore };
    for (const key of Object.keys(snapshot.states)) {
      if (key.startsWith('transcript:')) stores[key] = dev.transcriptStoreFor(key.slice('transcript:'.length));
    }
    for (const [key, state] of Object.entries(snapshot.states)) {
      stores[key].setState({ ...state, ...window.__verifyGuiActions?.[key], ...(key === 'store' ? { closePromptOpen: false } : {}) });
    }
    document.documentElement.dataset.theme = snapshot.theme;
  })(${JSON.stringify(data)})`);
}

export async function closeCheckOverlays(page) {
  await page.evaluate(async () => {
    const dev = window.__mageDev;
    if (dev.store.getState().closePromptOpen) {
      await window.mage.answerClose({ action: 'cancel', remember: false });
      dev.store.setState({ closePromptOpen: false });
    }
  });
  await page.evaluate(() => window.__mageDev.store.setState({
    settingsOpen: false, newTabOpen: false, addAccountOpen: false, handoffOpen: false,
    accountSwitchPrompt: null, trustRequests: [], updatePromptVersion: null,
  }));
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"][aria-modal="true"]').length === 0,
    undefined, { polling: STATE_POLL_MS, timeout: STATE_TIMEOUT_MS });
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
}

async function restoreDialogPosition(page, settings) {
  if (settings.section !== null) {
    await page.locator(`#${settings.section}`).click();
  }
  if (settings.mcpTab !== null) {
    await page.locator(`[data-mcp-tab="${settings.mcpTab}"]`).click();
  }
}
