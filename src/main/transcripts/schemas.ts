import { z } from 'zod';

// Esquemas Zod del formato NDJSON PERSISTIDO en ~/.claude*/projects/**/*.jsonl. DISTINTO del
// protocolo stream-json EN VIVO (ver ../engine/schemas.ts): aunque comparten los tipos user/
// assistant/system, la version persistida anade metadatos de historial (uuid/parentUuid/
// isSidechain/timestamp/cwd/gitBranch/version) y trae >10 tipos propios de la persistencia (mode,
// permission-mode, file-history-snapshot, attachment, ai-title, last-prompt, queue-operation,
// custom-title, agent-name...) que NO existen en el stream en vivo. NO unificar ambos esquemas.
//
// Verificado contra un archivo real (~9MB/2238 lineas) en vez de solo la documentacion del protocolo: los
// ejemplos de cada tipo estan documentados junto a su schema.

// Envelope minimo comun a CUALQUIER linea. `.passthrough()`: nunca rompe por campos extra/futuros.
// `type` es z.string() (NUNCA z.enum cerrado): apareceran tipos nuevos que no podemos prever.
export const TranscriptLineEnvelopeSchema = z
  .object({
    type: z.string(),
    uuid: z.string().nullish(),
    parentUuid: z.string().nullish(),
    isSidechain: z.boolean().optional(),
    // Marca de "linea inyectada por el CLI para su contabilidad" (aviso de imagen pegada,
    // <system-reminder>). MEDIDO en transcripciones reales: aparece como true y tambien como false, y
    // la mayoria de las lineas no lo traen. Aditivo y opcional: no invalida ninguna linea existente.
    isMeta: z.boolean().optional(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    gitBranch: z.string().optional(),
    version: z.string().optional(),
  })
  .passthrough();

// user: {"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"..."},
//        "uuid":"...","timestamp":"...","cwd":"...","sessionId":"...","version":"...","gitBranch":"..."}
// `content` es variable (string en la mayoria; array de bloques en tool_result/adjuntos).
export const TranscriptUserLineSchema = TranscriptLineEnvelopeSchema.extend({
  type: z.literal('user'),
  message: z
    .object({
      role: z.literal('user'),
      content: z.union([z.string(), z.array(z.unknown())]),
    })
    .passthrough(),
});

// usage de una linea assistant: {"input_tokens":2,"output_tokens":118,
//   "cache_creation_input_tokens":3809,"cache_read_input_tokens":221478,...}. Validacion LAXA
// (mismo patron que main/usage/schemas.ts): solo exigimos el tipo de los campos usados cuando
// existan; el saneado a entero >=0 se hace al normalizar (extractTokenUsage). Nunca lanza.
export const TranscriptUsageSchema = z
  .object({
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish(),
    cache_creation_input_tokens: z.number().nullish(),
    cache_read_input_tokens: z.number().nullish(),
  })
  .passthrough();

// assistant: {"parentUuid":"...","isSidechain":false,"message":{"model":"...","id":"...",
//             "type":"message","role":"assistant","content":[...],"usage":{...}}, "uuid":"...","timestamp":"..."}
export const TranscriptAssistantLineSchema = TranscriptLineEnvelopeSchema.extend({
  type: z.literal('assistant'),
  message: z
    .object({
      role: z.literal('assistant'),
      content: z.array(z.unknown()),
      model: z.string().nullish(),
      usage: TranscriptUsageSchema.nullish(),
    })
    .passthrough(),
});

// system: {"parentUuid":"...","isSidechain":false,"type":"system","subtype":"stop_hook_summary",
//          "hookCount":1,"hookInfos":[...],"toolUseID":"...","uuid":"...","timestamp":"..."}
// `subtype`/`hookInfos`/`toolUseID` son opcionales: hay otros subtypes con forma distinta.
export const TranscriptSystemLineSchema = TranscriptLineEnvelopeSchema.extend({
  type: z.literal('system'),
  subtype: z.string().optional(),
  hookInfos: z.array(z.unknown()).optional(),
  toolUseID: z.string().optional(),
});

// Cualquier otro tipo (los >10 catalogados de metadata + cualquier tipo futuro no visto): se
// conserva el envelope validado + el objeto crudo completo, sin mas validacion de forma. Ejemplos
// reales catalogados: mode, permission-mode, file-history-snapshot, attachment, last-prompt,
// ai-title, queue-operation, agent-name, custom-title.
export const TranscriptRawLineSchema = TranscriptLineEnvelopeSchema;

export type TranscriptUserLine = z.infer<typeof TranscriptUserLineSchema>;
export type TranscriptAssistantLine = z.infer<typeof TranscriptAssistantLineSchema>;
export type TranscriptSystemLine = z.infer<typeof TranscriptSystemLineSchema>;
export type TranscriptRawLine = z.infer<typeof TranscriptRawLineSchema>;
