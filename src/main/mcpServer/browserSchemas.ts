// Esquemas de las herramientas `mage_browser_*` (I3). Todos estrictos, como los de `schemas.ts`.
import { z } from 'zod';

export const MAX_BROWSER_URL_CHARS = 2048;
export const MAX_BROWSER_TYPE_CHARS = 10_000;
const MAX_SELECTOR_CHARS = 500;
const MAX_READ_NODES = 200;
const RECT_VALUES = 4;

const elementId = z.number().int().min(1);
const coordinate = z.number().finite().min(0);

export const browserNavigateInputSchema = z.object({ url: z.string().min(1).max(MAX_BROWSER_URL_CHARS) }).strict();
export const browserNavigateOutputSchema = z.object({ url: z.string(), title: z.string() }).strict();

export const browserScreenshotInputSchema = z.object({ annotate: z.boolean().optional() }).strict();

export const browserReadDomInputSchema = z
  .object({
    selector: z.string().min(1).max(MAX_SELECTOR_CHARS).optional(),
    maxNodes: z.number().int().min(1).max(MAX_READ_NODES).optional(),
  })
  .strict();
export const browserReadDomOutputSchema = z
  .object({
    url: z.string(),
    elements: z.array(
      z
        .object({
          id: elementId,
          role: z.string(),
          name: z.string(),
          rectDip: z.array(z.number().finite()).length(RECT_VALUES),
        })
        .strict(),
    ),
  })
  .strict();

export const browserClickInputSchema = z.object({ elementId: elementId.optional(), x: coordinate.optional(), y: coordinate.optional() }).strict();
export const browserTypeInputSchema = z.object({ elementId, text: z.string().min(1).max(MAX_BROWSER_TYPE_CHARS) }).strict();
export const browserUrlOutputSchema = z.object({ url: z.string() }).strict();

export const browserBackInputSchema = z.object({}).strict();
export const browserBackOutputSchema = z.object({ navigated: z.boolean() }).strict();
export const browserCloseInputSchema = z.object({}).strict();
export const browserCloseOutputSchema = z.object({ closed: z.boolean() }).strict();
