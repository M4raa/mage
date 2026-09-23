// Estado del workspace que persiste entre arranques (M2.5): la lista de pestañas abiertas y cuál era
// la activa. NO guarda el contenido de las conversaciones (eso vive en las transcripciones del CLI en
// disco) ni credenciales/tokens. Se serializa a JSON bajo app.getPath('userData').
//
// La FORMA se declara una sola vez, en `stateSchema.ts` (Zod), y aquí solo se derivan sus tipos: un
// campo que exista en el tipo sin existir en el esquema se perdería en silencio al guardar y al
// cargar (le pasó a `pinned`/`colorIndex`/`splitTabId`/`splitDirection`; ver la cabecera de ese
// módulo). El import es de SOLO TIPO: TypeScript lo borra al compilar, así que el renderer —que
// importa `WORKSPACE_STATE_VERSION` como valor de este módulo— sigue SIN Zod en su bundle.
import type { z } from 'zod';
import type * as Schema from './stateSchema';

// Se usa `z.infer` (= la salida del esquema), NUNCA `z.input`: lo que el renderer construye y lo que
// se escribe en disco es la forma ya validada. Y se envuelve en `Readonly` a mano —en vez de usar
// `.readonly()` de Zod— porque ese método hace `Object.freeze` del resultado en RUNTIME, y aquí solo
// hace falta el contrato de tipos.
// `alwaysAllowTools` se re-declara como array READONLY, igual que `tabs` en PersistedWorkspace mas
// abajo: `Readonly<>` no alcanza al INTERIOR de un array, y sin esto una `Tab` del store (que lo tiene
// readonly, como todo lo demas) no era asignable a una `PersistedTab`. Se hace por tipos y no con
// `.readonly()` de Zod por el motivo de arriba: ese metodo congela en runtime.
export type PersistedTab = Readonly<Omit<z.infer<typeof Schema.PERSISTED_TAB_SCHEMA>, 'alwaysAllowTools'>> & {
  readonly alwaysAllowTools?: readonly string[];
};

export type PersistedWorkspace = Readonly<Omit<z.infer<typeof Schema.WORKSPACE_SCHEMA>, 'tabs'>> & {
  readonly tabs: readonly PersistedTab[];
};

// Arbol de division del centro (I11). Se re-exporta el tipo de `stateSchema.ts` (no se declara aqui a
// mano) por la misma razon que `PersistedTab`: un campo no puede existir en el TIPO sin existir en el
// esquema Zod que de verdad valida lo que se lee/escribe en disco.
export type SplitLayout = Schema.SplitLayoutShape;

// Privacidad de una conversación (M2.6): 'shared' (por defecto, historial en el pozo común de la
// cuenta) o 'private' (historial en el perfil privado `mage-private` de la cuenta, mismo login).
// Derivado del esquema por el mismo motivo: un solo sitio donde se declaran los dos valores.
export type ConversationPrivacy = PersistedTab['privacy'];

// Versión del esquema persistido. Subir al cambiar la forma de PersistedWorkspace de forma
// incompatible (permite migraciones o descartar estado viejo sin romper el arranque).
export const WORKSPACE_STATE_VERSION = 1;
