// Estado del registro del servidor MCP `mage` en la config de cada CLI. Puro: quien llama lee el fichero.
export const MAGE_MCP_SERVER_NAME = 'mage';

const CODEX_MAGE_TABLES: readonly string[] = [`[mcp_servers.${MAGE_MCP_SERVER_NAME}]`, `[mcp_servers."${MAGE_MCP_SERVER_NAME}"]`];

// Es la tabla que escribe `codex mcp add mage` (H4). Una linea comentada no cuenta.
export function codexConfigHasMageServer(configToml: string): boolean {
  return configToml.split(/\r?\n/).some((line) => CODEX_MAGE_TABLES.includes(line.trim()));
}

// Excepcion documentada a «nada de catch silencioso»: el fichero es del CLI y Mage solo informa; un JSON
// invalido da `false` y NO lanza (el llamante lo loguea si le importa).
export function claudeConfigHasMageServer(claudeJson: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(claudeJson);
  } catch {
    return false;
  }
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (typeof servers !== 'object' || servers === null) return false;
  const mage = (servers as Record<string, unknown>)[MAGE_MCP_SERVER_NAME];
  return typeof mage === 'object' && mage !== null;
}

export interface CodexHomeReader {
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string;
  readonly join: (...parts: string[]) => string;
  readonly warn: (message: string, data: Record<string, unknown>) => void;
}

// ¿Tiene el CODEX_HOME dado `mage` registrado? Fichero ausente = false; error de lectura = aviso (solo la
// ruta, nunca el contenido) y false.
export function codexHomeHasMageServer(home: string, reader: CodexHomeReader): boolean {
  const path = reader.join(home, 'config.toml');
  if (!reader.exists(path)) return false;
  try {
    return codexConfigHasMageServer(reader.read(path));
  } catch (error) {
    reader.warn('No se pudo leer el config.toml de Codex', { path, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
