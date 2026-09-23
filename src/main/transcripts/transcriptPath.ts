import { join } from 'node:path';

// `projects` es una de las SHARED_FOLDERS enlazadas entre TODAS las cuentas (ver
// accountService.ts SHARED_FOLDERS), asi que la transcripcion de cualquier sesion vive bajo
// <accountDir>/projects/<carpeta-cwd-codificada>/<sessionId>.jsonl sea cual sea la cuenta activa.
//
// La codificacion de carpeta del CLI reemplaza CADA caracter no alfanumerico por un guion `-`
// individual (sin colapsar guiones consecutivos). Verificado contra un ejemplo real: el cwd
// "C:\sourcecode\itb.sysMonitor" (con los dos puntos, las barras invertidas Y el punto) produce
// la carpeta real "C--sourcecode-itb-sysMonitor".
const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;

// Valida en la frontera que un argumento es un string no vacio (nunca undefined/no-string): un
// desalineo de argumentos por IPC daria si no un cripto "Cannot read properties of undefined
// (reading 'trim')" en vez de un mensaje con el valor recibido.
function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} invalido para resolver transcripcion: ${JSON.stringify(value)}`);
  }
  return value;
}

// Un token seguro como SEGMENTO de ruta: alfanumericos, guiones y guiones bajos, no vacio. Rechaza
// separadores y `..` para impedir path traversal cuando el valor (sessionId/agentId) viene por IPC y
// se usa como nombre de carpeta/fichero (no solo como parte final de la ruta). Los sessionId son
// UUID y los agentId hex, asi que este patron los cubre sin falsos negativos.
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

function requireSafePathSegment(value: unknown, name: string): string {
  const str = requireNonEmptyString(value, name);
  if (!SAFE_PATH_SEGMENT.test(str)) {
    throw new Error(`${name} contiene caracteres no permitidos para una ruta: ${JSON.stringify(value)}`);
  }
  return str;
}

// Codifica un cwd absoluto al nombre de carpeta que usa el CLI bajo projects/.
export function encodeProjectFolderName(cwd: string): string {
  requireNonEmptyString(cwd, 'cwd');
  return cwd.replace(NON_ALPHANUMERIC, '-');
}

// Ruta absoluta de la transcripcion persistida de una sesion dada su cuenta y cwd de arranque.
export function resolveTranscriptPath(accountDir: string, cwd: string, sessionId: string): string {
  requireNonEmptyString(accountDir, 'accountDir');
  requireNonEmptyString(sessionId, 'sessionId');
  const folder = encodeProjectFolderName(cwd);
  return join(accountDir, 'projects', folder, `${sessionId}.jsonl`);
}

// Ruta absoluta del transcript de un SUBAGENTE (drill-down, M2.2.3b). Vive en un fichero aparte bajo
// la carpeta de la sesion: <accountDir>/projects/<cwd-encoded>/<sessionId>/subagents/agent-<id>.jsonl
// El formato de linea es identico al transcript principal (se reutiliza el mismo parser). sessionId y
// agentId se validan como segmentos seguros: aqui pasan a ser CARPETA y NOMBRE de fichero (no solo
// sufijo), asi que un `..` permitiria escapar del directorio de la cuenta.
export function resolveSubagentTranscriptPath(accountDir: string, cwd: string, sessionId: string, agentId: string): string {
  requireNonEmptyString(accountDir, 'accountDir');
  const safeSessionId = requireSafePathSegment(sessionId, 'sessionId');
  const safeAgentId = requireSafePathSegment(agentId, 'agentId');
  const folder = encodeProjectFolderName(cwd);
  return join(accountDir, 'projects', folder, safeSessionId, 'subagents', `agent-${safeAgentId}.jsonl`);
}
