// La credencial que identifica a una sesion de Mage ante `mage mcp` (D-M6). Es un secreto: nunca se
// loguea ni se emite.
export const MAGE_MCP_CALLER_ENV = 'MAGE_MCP_CALLER';
export const MCP_CALLER_BYTES = 32;

export interface McpCallersDeps {
  readonly randomBytes: (size: number) => Buffer;
  readonly isLive: (sessionId: string) => boolean;
}

// Registro sesion <-> credencial de llamante. Vive en main; la credencial solo viaja al hijo de su sesion.
export class McpCallers {
  private readonly bySession = new Map<string, string>();
  private readonly byCredential = new Map<string, string>();

  constructor(private readonly deps: McpCallersDeps) {}

  // Un relanzado del mismo proceso no cambia la credencial.
  mint(sessionId: string): string {
    if (sessionId.length === 0) throw new Error(`McpCallers.mint: sessionId vacio (${JSON.stringify(sessionId)})`);
    const existing = this.bySession.get(sessionId);
    if (existing !== undefined) return existing;
    const credential = this.deps.randomBytes(MCP_CALLER_BYTES).toString('hex');
    this.bySession.set(sessionId, credential);
    this.byCredential.set(credential, sessionId);
    return credential;
  }

  // ponytail: las entradas de sesiones muertas se borran al consultarlas; una por sesion lanzada en esta
  // ejecucion de main, sin mas tope.
  resolve(credential: string | undefined): string | null {
    if (credential === undefined || credential.length === 0) return null;
    const sessionId = this.byCredential.get(credential);
    if (sessionId === undefined) return null;
    if (this.deps.isLive(sessionId)) return sessionId;
    this.byCredential.delete(credential);
    this.bySession.delete(sessionId);
    return null;
  }
}
