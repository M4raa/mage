// Lo que hace el agente de UNA sesión con SU navegador (I3). La sesión la fija main al crear el puerto: el agente
// no puede elegir otra.
import type { BrowserToolsPort } from '../mcpServer/browserTools';
import { composeCapture, type ImageDeps } from './annotatedCapture';
import type { BrowserRegistry } from './browserRegistry';
import { formatElementList } from './captureAnnotation';

export interface BrowserAgentDeps {
  readonly registry: BrowserRegistry;
  readonly sessionId: string;
  readonly imageDeps: ImageDeps;
}

export function createBrowserAgent(deps: BrowserAgentDeps): BrowserToolsPort {
  const { registry, sessionId, imageDeps } = deps;
  return {
    async navigate(url) {
      const handle = registry.beginAgentAction(sessionId, 'navigate');
      await handle.navigate(url);
      const { url: finalUrl, title } = handle.state();
      return { url: finalUrl, title };
    },
    async screenshot(annotate) {
      const handle = registry.beginAgentAction(sessionId, 'screenshot');
      // Primero la lectura: los id numerados en la imagen son los de esta lectura.
      const elements = annotate ? await handle.readDom({}) : [];
      const raw = await handle.captureRaw();
      const capture = composeCapture(raw, { elements, strokes: [] }, imageDeps);
      return { png: capture.image.base64, url: capture.url, elementsText: formatElementList(elements), annotated: annotate };
    },
    async readDom(options) {
      const handle = registry.beginAgentAction(sessionId, 'read_dom');
      const elements = await handle.readDom(options);
      return { url: handle.state().url, elements };
    },
    async click(target) {
      const handle = registry.beginAgentAction(sessionId, 'click');
      await handle.click(target);
      return { url: handle.state().url };
    },
    async type(input) {
      const handle = registry.beginAgentAction(sessionId, 'type');
      await handle.type(input);
      return { url: handle.state().url };
    },
    async back() {
      const handle = registry.beginAgentAction(sessionId, 'back');
      return { navigated: handle.back() };
    },
    async close() {
      if (registry.get(sessionId) === null) return { closed: false };
      registry.beginAgentAction(sessionId, 'close');
      return { closed: await registry.close(sessionId) };
    },
  };
}
