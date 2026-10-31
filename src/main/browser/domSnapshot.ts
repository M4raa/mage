// Opciones de readDom y validación con Zod de lo que devuelve el script fijo inyectado en la página.
// Frontera: la página no es de confianza, así que cada elemento se valida antes de usarlo.
import { z } from 'zod';

export const MAX_DOM_NODES = 200;
export const MAX_NAME_LENGTH = 200;
export const MAX_ROLE_LENGTH = 64;
export const MAX_SELECTOR_LENGTH = 500;

// Lo interactivo: lo que el agente puede pulsar o rellenar.
export const DEFAULT_DOM_SELECTOR = 'a[href],button,input,textarea,select,[role],[contenteditable="true"]';

export interface ReadDomOptions {
  selector?: string;
  maxNodes?: number;
}

export interface ResolvedReadDomOptions {
  selector: string;
  maxNodes: number;
}

function resolveMaxNodes(maxNodes: number | undefined): number {
  if (maxNodes === undefined) return MAX_DOM_NODES;
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_DOM_NODES) {
    throw new Error(`maxNodes debe ser un entero entre 1 y ${MAX_DOM_NODES}: ${maxNodes}`);
  }
  return maxNodes;
}

function resolveSelector(selector: string | undefined): string {
  if (selector === undefined) return DEFAULT_DOM_SELECTOR;
  const trimmed = selector.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SELECTOR_LENGTH) {
    throw new Error(`Selector no válido (vacío o de más de ${MAX_SELECTOR_LENGTH} caracteres): «${selector}»`);
  }
  return trimmed;
}

/** Valida y completa las opciones de readDom con sus valores por defecto. */
export function resolveReadDomOptions(options: ReadDomOptions): ResolvedReadDomOptions {
  return {
    selector: resolveSelector(options.selector),
    maxNodes: resolveMaxNodes(options.maxNodes),
  };
}

const finiteNumber = z.number().finite();
const sizeNumber = z.number().finite().nonnegative();

// .strict() a propósito: la salida es de NUESTRO script; una clave de más significa que algo no es lo que creemos.
const rawElementSchema = z
  .object({
    role: z.string().min(1).max(MAX_ROLE_LENGTH),
    name: z.string().max(MAX_NAME_LENGTH),
    rectDip: z.tuple([finiteNumber, finiteNumber, sizeNumber, sizeNumber]),
  })
  .strict();

export type RawDomElement = z.infer<typeof rawElementSchema>;

/** Valida la lectura del DOM que devuelve la página y lanza si no tiene la forma esperada. */
export function parseDomSnapshot(value: unknown, maxNodes: number): RawDomElement[] {
  const result = z.array(rawElementSchema).max(maxNodes).safeParse(value);
  if (!result.success) {
    throw new Error(`La lectura del DOM no tiene la forma esperada: ${result.error.message}`);
  }
  return result.data;
}
