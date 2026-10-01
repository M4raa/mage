import { z } from 'zod';

// Esquemas de lo que devuelve un servidor OpenAI-compatible (Chat Completions y catalogos). Frontera
// externa: TOLERANTES a proposito (`.passthrough()` para campos que no conocemos, `.catch()` para que un
// campo con otra forma no tire el trozo entero). Formas contra las que se escribieron:
//   - OpenAI Chat Completions (streaming, `stream_options.include_usage`), documentacion publica 2026-09.
//   - Ollama `/v1` (OpenAI-compatible): cada tool call ENTERA en un trozo, sin trozo de uso.
//   - Las seis formas del spike `spike/runtime-spike.mjs` (2026-09-30, servidor falso).

const optionalString = z.string().optional().catch(undefined);

// Un fragmento de tool call dentro de un delta. `id` y `name` solo llegan en el primero de cada llamada;
// `arguments` llega troceado. `index` puede faltar en servidores que no lo mandan (sin medir en Ollama).
export const TOOL_CALL_DELTA_SCHEMA = z
  .object({
    index: z.number().int().nonnegative().optional().catch(undefined),
    id: optionalString,
    function: z
      .object({ name: optionalString, arguments: optionalString })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough();

export type ToolCallDelta = z.infer<typeof TOOL_CALL_DELTA_SCHEMA>;

const DELTA_SCHEMA = z
  .object({
    content: z.string().nullable().optional().catch(undefined),
    // Razonamiento: `reasoning_content` (DeepSeek, LM Studio) o `reasoning` (Ollama, OpenRouter).
    reasoning_content: z.string().nullable().optional().catch(undefined),
    reasoning: z.string().nullable().optional().catch(undefined),
    tool_calls: z.array(TOOL_CALL_DELTA_SCHEMA).optional().catch(undefined),
  })
  .passthrough();

const CHOICE_SCHEMA = z
  .object({
    delta: DELTA_SCHEMA.optional().catch(undefined),
    finish_reason: z.string().nullable().optional().catch(undefined),
  })
  .passthrough();

// Un trozo `chat.completion.chunk`. El de uso final de OpenAI llega con `choices: []`.
export const CHAT_CHUNK_SCHEMA = z
  .object({
    model: optionalString,
    choices: z.array(CHOICE_SCHEMA).catch([]),
    usage: z.unknown().optional(),
  })
  .passthrough();

export type ChatChunk = z.infer<typeof CHAT_CHUNK_SCHEMA>;
