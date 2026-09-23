// Jump list de Windows (Ronda 3, item 10: "clic derecho en el icono de la app -> recientes y cuentas
// mas usadas"). Modulo PURO: no importa `electron` ni toca el FS, asi que las dos decisiones que
// importan —que entra en la lista y en que orden, y como se vuelve a leer el clic— se prueban sin
// arrancar la app. `main/index.ts` recoge los datos, llama aqui y pasa el resultado a `app.setJumpList`.

// Forma de los items que acepta Electron (subconjunto que usamos: solo tareas). Se declara aqui en vez
// de importar los tipos de electron para que este modulo siga siendo puro y testeable en Node.
export interface JumpListTask {
  readonly type: 'task';
  readonly program: string;
  readonly args: string;
  readonly title: string;
  readonly description: string;
}

export interface JumpListCategory {
  readonly type: 'custom';
  readonly name: string;
  readonly items: readonly JumpListTask[];
}

export interface JumpListAccount {
  readonly configDir: string;
  readonly alias: string;
}

export interface JumpListConversation {
  readonly sessionId: string;
  readonly title: string;
  readonly accountDir: string;
  readonly updatedAtMs: number;
}

export interface JumpListSource {
  readonly accounts: readonly JumpListAccount[];
  readonly conversations: readonly JumpListConversation[];
  // `accountId` de cada pestaña abierta/persistida. Es la unica señal de "cuenta mas usada" que existe
  // hoy: AccountInfo no lleva ningun contador de uso.
  readonly tabAccountIds: readonly string[];
}

// Banderas con las que la jump list relanza Mage. La instancia unica (grupo G) hace que ese segundo
// proceso se rinda y mande su argv a la que ya esta viva, que es quien las interpreta.
export const JUMP_LIST_ACCOUNT_FLAG = '--mage-account=';
export const JUMP_LIST_SESSION_FLAG = '--mage-session=';

const MAX_RECENT_CONVERSATIONS = 8;
const MAX_ACCOUNTS = 5;
const MAX_TITLE_CHARS = 60;

export interface JumpListRequest {
  readonly accountDir: string;
  // Ausente => "abrir una conversacion NUEVA en esa cuenta" (item de la categoria Cuentas).
  readonly sessionId?: string;
}

// Relee la peticion desde el argv del proceso relanzado. Devuelve null si no hay ninguna bandera
// nuestra (arranque normal del usuario) o si viene una sesion sin cuenta, que no se puede resolver.
export function parseJumpListArgs(argv: readonly string[]): JumpListRequest | null {
  const accountDir = valueOfFlag(argv, JUMP_LIST_ACCOUNT_FLAG);
  if (accountDir === null) return null;
  const sessionId = valueOfFlag(argv, JUMP_LIST_SESSION_FLAG);
  return sessionId === null ? { accountDir } : { accountDir, sessionId };
}

function valueOfFlag(argv: readonly string[], flag: string): string | null {
  const found = argv.find((arg) => arg.startsWith(flag));
  if (found === undefined) return null;
  const value = found.slice(flag.length).trim();
  return value.length === 0 ? null : value;
}

// Cuentas ordenadas por USO (nº de pestañas que las referencian) y, a igualdad, por su orden de
// descubrimiento — que es estable y es el que fija su acento de color.
export function accountsByUsage(
  accounts: readonly JumpListAccount[],
  tabAccountIds: readonly string[],
): readonly JumpListAccount[] {
  const usage = new Map<string, number>(); // indexado: O(1) por cuenta en vez de un filter por cada una
  for (const id of tabAccountIds) usage.set(id, (usage.get(id) ?? 0) + 1);
  return accounts
    .map((account, index) => ({ account, index, uses: usage.get(account.configDir) ?? 0 }))
    .sort((a, b) => (b.uses - a.uses) || (a.index - b.index))
    .map((entry) => entry.account);
}

// Las dos categorias de la jump list. Vacias las que no tengan nada: Windows no pinta una categoria
// sin items, y devolver [] borra la lista entera (que es justo lo que se quiere sin datos).
export function buildJumpListCategories(source: JumpListSource, program: string): readonly JumpListCategory[] {
  const categories: JumpListCategory[] = [];

  const recent = [...source.conversations]
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, MAX_RECENT_CONVERSATIONS);
  if (recent.length > 0) {
    categories.push({
      type: 'custom',
      name: 'Recientes',
      items: recent.map((conversation) => ({
        type: 'task',
        program,
        args: `${quoted(JUMP_LIST_ACCOUNT_FLAG, conversation.accountDir)} ${quoted(JUMP_LIST_SESSION_FLAG, conversation.sessionId)}`,
        title: shorten(conversation.title),
        description: 'Abrir esta conversación en Mage',
      })),
    });
  }

  const accounts = accountsByUsage(source.accounts, source.tabAccountIds).slice(0, MAX_ACCOUNTS);
  if (accounts.length > 0) {
    categories.push({
      type: 'custom',
      name: 'Cuentas',
      items: accounts.map((account) => ({
        type: 'task',
        program,
        args: quoted(JUMP_LIST_ACCOUNT_FLAG, account.configDir),
        title: shorten(account.alias),
        description: `Nueva conversación en ${account.alias}`,
      })),
    });
  }

  return categories;
}

// `--flag=valor` con el valor entrecomillado: los configDir y los titulos llevan espacios a menudo, y
// sin comillas Windows partiria el argumento en varios.
function quoted(flag: string, value: string): string {
  return `${flag}"${value.replace(/"/g, '')}"`;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return 'Sin título';
  return flat.length <= MAX_TITLE_CHARS ? flat : `${flat.slice(0, MAX_TITLE_CHARS - 1)}…`;
}
