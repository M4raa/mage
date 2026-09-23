import { sanitizeAlwaysAllow } from './permissionRules';
import type { ConversationPrefs } from '@shared/conversationIndex';
import type { PermissionMode } from '@shared/ipc';
import { PERMISSION_MODES } from '@shared/ipc';
import { resolveDefaultModel } from './modelDefaults';

// Decision PURA de con que modelo, esfuerzo y modo de permiso se abre una conversacion del historial
// (2.1). Vive fuera de `openConversation` a proposito: esa es una accion del store con `set`/`get` y no
// se testea bien; esto son datos -> datos.
//
// El indice de Mage MANDA sobre los defaults: si el usuario dejo esa conversacion en `high` + `plan`,
// reabrirla tiene que devolverla ahi. Lo que el indice no tenga cae a la cadena de siempre.

export interface ReopenedTabPrefsContext {
  // Lo guardado para ESA conversacion (null si nunca se guardo nada).
  readonly indexPrefs: ConversationPrefs | null;
  readonly accountDefaultModel: string | null;
  // Modelo configurado para el proveedor en Ajustes -> Modelos (F3). HALLAZGO 3: `openConversation` no
  // lo pasaba —solo `createConversation` lo hacia—, asi que reabrir del historial se saltaba ese ajuste.
  readonly providerDefaultModel: string | null;
}

export interface ReopenedTabPrefs {
  readonly model: string;
  readonly effort?: string;
  readonly permissionMode?: PermissionMode;
  // Reglas "Permitir siempre <tool> aqui" con las que se dejo la conversacion (2.3b).
  readonly alwaysAllowTools?: readonly string[];
}

export function resolveReopenedTabPrefs(ctx: ReopenedTabPrefsContext): ReopenedTabPrefs {
  const saved = ctx.indexPrefs;
  const model = firstNonEmpty(saved?.model)
    ?? resolveDefaultModel({
      lastUsedModel: null,
      accountDefaultModel: ctx.accountDefaultModel,
      providerDefaultModel: ctx.providerDefaultModel,
    });
  const effort = firstNonEmpty(saved?.effort);
  const permissionMode = toPermissionMode(saved?.permissionMode);
  const alwaysAllowTools = sanitizeAlwaysAllow(saved?.alwaysAllowTools);
  return {
    model,
    // Las claves ausentes NO se ponen a undefined: `Tab` las declara opcionales y un `effort:
    // undefined` explicito acabaria viajando al workspace persistido como ruido.
    ...(effort === undefined ? {} : { effort }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(alwaysAllowTools.length === 0 ? {} : { alwaysAllowTools }),
  };
}

// Modo de permiso guardado -> modo valido. Un valor que ya no existe en el catalogo (fichero editado a
// mano, version anterior de Mage) cae a `undefined`, que significa "el default del CLI": nunca se
// arranca una sesion con un modo que el CLI no conoce.
function toPermissionMode(value: string | undefined): PermissionMode | undefined {
  if (value === undefined) return undefined;
  return PERMISSION_MODES.find((mode) => mode === value);
}

function firstNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

// Lo que hay que GUARDAR en el indice de una pestaña. Se llama al crear la sesion y en cada cambio de
// modelo/esfuerzo/modo: los tres viven en la `Tab`, y el indice es su copia duradera.
//
// `effort` vacio viaja como cadena vacia (no como ausente) A PROPOSITO: el store trata '' como "sin
// esfuerzo", y el indice lo interpreta como BORRAR el campo. Con `undefined` se conservaria el valor
// viejo y la conversacion seguiria reabriendose con el esfuerzo que el usuario acaba de quitar.
export function toConversationPrefs(tab: {
  readonly model: string;
  readonly effort?: string;
  readonly permissionMode?: PermissionMode;
  readonly alwaysAllowTools?: readonly string[];
}): ConversationPrefs {
  return {
    model: tab.model,
    effort: tab.effort ?? '',
    ...(tab.permissionMode === undefined ? {} : { permissionMode: tab.permissionMode }),
    // Se manda SIEMPRE que la pestana tenga el campo, aunque este vacio: la lista es el estado completo
    // de las reglas, y vacia significa "revocadas todas" — omitirla dejaria en el indice las que el
    // usuario acaba de quitar.
    ...(tab.alwaysAllowTools === undefined ? {} : { alwaysAllowTools: tab.alwaysAllowTools }),
  };
}
