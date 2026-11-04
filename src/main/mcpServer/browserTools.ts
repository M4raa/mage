// Las siete herramientas `mage_browser_*` (I3) sobre el servidor MCP de Mage. Solo se registran con una sesión de
// Mage detrás (D-S5): el puerto ya viene atado a SU navegador y el agente nunca elige la sesión.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrowserControlError } from '../browser/browserRegistry';
import type { DomElement } from '../browser/elementRegistry';
import { MagePolicyError } from './errors';
import { safeToolResult } from './handlers';
import * as schemas from './browserSchemas';

export interface BrowserToolsPort {
  navigate(url: string): Promise<{ readonly url: string; readonly title: string }>;
  screenshot(annotate: boolean): Promise<{ readonly png: string; readonly url: string; readonly elementsText: string; readonly annotated: boolean }>;
  readDom(options: { readonly selector?: string; readonly maxNodes?: number }): Promise<{ readonly url: string; readonly elements: readonly DomElement[] }>;
  click(target: { readonly elementId: number } | { readonly x: number; readonly y: number }): Promise<{ readonly url: string }>;
  type(input: { readonly elementId: number; readonly text: string }): Promise<{ readonly url: string }>;
  back(): Promise<{ readonly navigated: boolean }>;
  close(): Promise<{ readonly closed: boolean }>;
}

// Lo lee el modelo: castellano.
export const BROWSER_TOOL_DESCRIPTIONS = {
  navigate: 'Abre una URL (http, https o localhost) en el navegador de Mage de ESTA sesión, visible para el usuario en el panel «Navegador». Lo abre si no estaba abierto. Devuelve la URL final y el título.',
  screenshot: 'Captura la página del navegador de esta sesión (PNG de hasta 1568 px). Con annotate: true numera los elementos interactivos y devuelve su lista «id: rol "nombre" (x,y,ancho,alto)» en DIP; esos id valen para mage_browser_click y mage_browser_type hasta la siguiente lectura.',
  read_dom: 'Lista los elementos interactivos de la página (o los que casen con selector), hasta maxNodes (máximo 200), con id, rol, nombre y rectángulo en DIP. Cada lectura caduca los id anteriores; navegar y volver atrás también.',
  click: 'Hace clic en un elemento (elementId de la última lectura) o en unas coordenadas DIP (x e y). No desplaza la página.',
  type: 'Escribe texto en un elemento (elementId de la última lectura): hace clic en él e inserta el texto.',
  back: 'Vuelve a la página anterior del navegador de esta sesión. Caduca los id.',
  close: 'Cierra el navegador de esta sesión y borra sus datos (cookies incluidas).',
} as const;

const INVALID_RESULT_TEXT = 'invalid_result: respuesta fuera del contrato';

// La frontera: los mensajes del navegador son nuestros (castellano, con el valor) y pueden cruzar al agente.
function toPolicyError(error: unknown): MagePolicyError {
  if (error instanceof MagePolicyError) return error;
  if (error instanceof BrowserControlError) return new MagePolicyError(`${error.code}: ${error.message}`);
  if (error instanceof Error) return new MagePolicyError(`browser_failed: ${error.message}`);
  return new MagePolicyError(`browser_failed: ${String(error)}`);
}

async function callBrowser<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toPolicyError(error);
  }
}

export function parseClickTarget(input: { elementId?: number; x?: number; y?: number }): { elementId: number } | { x: number; y: number } {
  const { elementId, x, y } = input;
  if (elementId !== undefined && x === undefined && y === undefined) return { elementId };
  if (elementId === undefined && x !== undefined && y !== undefined) return { x, y };
  throw new MagePolicyError('invalid_input: indica elementId, o x e y, pero no los dos');
}

export async function imageToolResult(call: () => Promise<{ png: string; text: string }>) {
  try {
    const { png, text } = await call();
    return { content: [{ type: 'image' as const, data: png, mimeType: 'image/png' }, { type: 'text' as const, text }] };
  } catch (error) {
    const text = error instanceof MagePolicyError ? error.message : INVALID_RESULT_TEXT;
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}

function screenshotText(shot: { url: string; elementsText: string; annotated: boolean }): string {
  const head = `URL: ${shot.url}`;
  if (!shot.annotated) return head;
  return shot.elementsText.length === 0 ? `${head}\nElementos: ninguno interactivo` : `${head}\nElementos:\n${shot.elementsText}`;
}

// Llama al puerto y valida la salida contra su esquema antes de devolverla al agente.
function jsonTool<T>(output: { parse(value: unknown): Record<string, unknown> }, call: () => Promise<T>) {
  return safeToolResult(async () => output.parse(await callBrowser(call)));
}

export function registerBrowserTools(server: McpServer, port: BrowserToolsPort): void {
  registerPageTools(server, port);
  registerActionTools(server, port);
}

function registerPageTools(server: McpServer, port: BrowserToolsPort): void {
  const text = BROWSER_TOOL_DESCRIPTIONS;
  server.registerTool('mage_browser_navigate', { description: text.navigate, inputSchema: schemas.browserNavigateInputSchema, outputSchema: schemas.browserNavigateOutputSchema }, (input) => jsonTool(schemas.browserNavigateOutputSchema, () => port.navigate(input.url)));
  server.registerTool('mage_browser_screenshot', { description: text.screenshot, inputSchema: schemas.browserScreenshotInputSchema }, (input) => imageToolResult(async () => {
    const shot = await callBrowser(() => port.screenshot(input.annotate ?? false));
    return { png: shot.png, text: screenshotText(shot) };
  }));
  server.registerTool('mage_browser_read_dom', { description: text.read_dom, inputSchema: schemas.browserReadDomInputSchema, outputSchema: schemas.browserReadDomOutputSchema }, (input) => jsonTool(schemas.browserReadDomOutputSchema, () => port.readDom(input)));
}

function registerActionTools(server: McpServer, port: BrowserToolsPort): void {
  const text = BROWSER_TOOL_DESCRIPTIONS;
  server.registerTool('mage_browser_click', { description: text.click, inputSchema: schemas.browserClickInputSchema, outputSchema: schemas.browserUrlOutputSchema }, (input) => safeToolResult(async () => {
    const target = parseClickTarget(input);
    return schemas.browserUrlOutputSchema.parse(await callBrowser(() => port.click(target)));
  }));
  server.registerTool('mage_browser_type', { description: text.type, inputSchema: schemas.browserTypeInputSchema, outputSchema: schemas.browserUrlOutputSchema }, (input) => jsonTool(schemas.browserUrlOutputSchema, () => port.type(input)));
  server.registerTool('mage_browser_back', { description: text.back, inputSchema: schemas.browserBackInputSchema, outputSchema: schemas.browserBackOutputSchema }, () => jsonTool(schemas.browserBackOutputSchema, () => port.back()));
  server.registerTool('mage_browser_close', { description: text.close, inputSchema: schemas.browserCloseInputSchema, outputSchema: schemas.browserCloseOutputSchema }, () => jsonTool(schemas.browserCloseOutputSchema, () => port.close()));
}
