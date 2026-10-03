// Logins OAuth PENDIENTES de los servidores MCP del runtime propio, a nivel de APP (D3 de P-033, M2 de
// la revision): uno por servidor, compartido por todas las sesiones que lo usan. Mage ya no abre el
// navegador solo: la sesion avisa con un boton «Iniciar sesión» y es el usuario quien lo abre (`open`).
// Una segunda pestaña con el mismo servidor se une al login que ya hay, asi que tampoco hay dos
// callbacks peleando por un `callbackPort` fijo.
//
// ponytail: un login que nadie abre sigue registrado (y su callback escuchando) hasta salir de Mage o
// hasta que alguien lo abra y venza el tope; si molestara, caducarlo por tiempo.

export interface PendingLogin {
  readonly id: string;
  readonly authorized: Promise<void>;
}

export interface McpLogins {
  pendingFor(key: string): PendingLogin | null;
  // `complete` espera el codigo del callback y lo canjea; no se llama hasta que el usuario abre el login.
  // Si ya habia uno para `key`, devuelve ese y `created` es false (quien llama cierra su callback).
  register(key: string, url: string, complete: () => Promise<void>): PendingLogin & { readonly created: boolean };
}

interface Entry extends PendingLogin {
  readonly key: string;
  readonly url: string;
  readonly complete: () => Promise<void>;
  readonly settle: { resolve: () => void; reject: (err: unknown) => void };
  started: boolean;
}

export interface McpLoginRegistryDeps {
  readonly openUrl: (url: string) => Promise<void>;
  readonly newId: () => string;
}

export class McpLoginRegistry implements McpLogins {
  private readonly byKey = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();

  constructor(private readonly deps: McpLoginRegistryDeps) {}

  pendingFor(key: string): PendingLogin | null {
    return this.byKey.get(key) ?? null;
  }

  register(key: string, url: string, complete: () => Promise<void>): PendingLogin & { readonly created: boolean } {
    const existing = this.byKey.get(key);
    if (existing !== undefined) return { id: existing.id, authorized: existing.authorized, created: false };
    let settle: Entry['settle'] = { resolve: () => undefined, reject: () => undefined };
    const authorized = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
    const entry: Entry = { id: this.deps.newId(), key, url, complete, settle, authorized, started: false };
    this.byKey.set(key, entry);
    this.byId.set(entry.id, entry);
    return { id: entry.id, authorized, created: true };
  }

  // Lo que hace el boton «Iniciar sesión»: empieza a esperar el codigo (una vez) y abre el navegador
  // (cada vez que se pulse, por si el usuario cerro la pestaña del navegador).
  async open(id: string): Promise<void> {
    const entry = this.byId.get(id);
    if (entry === undefined) throw new Error(`Inicio de sesión MCP inexistente o ya terminado: ${JSON.stringify(id)}`);
    if (!entry.started) {
      entry.started = true;
      entry
        .complete()
        .then(entry.settle.resolve, entry.settle.reject)
        .finally(() => this.forget(entry));
    }
    await this.deps.openUrl(entry.url);
  }

  private forget(entry: Entry): void {
    this.byKey.delete(entry.key);
    this.byId.delete(entry.id);
  }
}
