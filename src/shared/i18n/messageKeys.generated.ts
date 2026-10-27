// GENERADO por scripts/i18n-types.mjs a partir de catalogs/es.json. No se edita a mano: `pnpm i18n:types`.
// `never` = el mensaje no tiene variables.
export interface MessageValues {
  readonly "settings.language.en": never;
  readonly "settings.language.es": never;
  readonly "settings.language.hint": never;
  readonly "settings.language.label": never;
  readonly "settings.language.system": never;
  readonly "settings.language.systemHint": { readonly "language": string | number };
}

export type MessageKey = keyof MessageValues;

// Argumentos de `t(key, ...)`: nada si el mensaje no tiene variables; si las tiene, el objeto es obligatorio.
export type MessageArgs<K extends MessageKey> = [MessageValues[K]] extends [never] ? [] : [values: MessageValues[K]];
