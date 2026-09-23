import { normalize, resolve } from 'node:path';

// Confianza por CARPETA antes de lanzar un agente en ella.
//
// Por que existe: el CLI arranca CON la carpeta como cwd y ejecuta lo que esa carpeta traiga —hooks,
// `.claude/settings.json`, servidores MCP declarados en el repo—. Abrir un repositorio ajeno es, sin
// mas, ejecutar codigo ajeno. El CLI tiene su propio dialogo de confianza, pero MEDIDO en su codigo
// solo lo consulta en la TUI interactiva: en modo headless (el unico que usa Mage) sale por
// `isNonInteractiveSession` antes de mirarlo. O sea que nadie pregunta si no pregunta Mage.
//
// Modulo PURO (datos -> datos), sin FS: lo unico que toca disco es la lectura de la decision que el
// usuario ya tomara en el CLI, y esa vive en `readCliTrustedFolders` con sus deps inyectadas.

// Clave canonica de una carpeta. MISMA forma que usa el CLI en su config (`normalizePathForConfigKey`:
// normalizar y pasar todo a barras normales), para que las dos hablen de la misma carpeta y Mage pueda
// leer lo que el usuario ya autorizo alli. En Windows ademas se compara sin distinguir mayusculas.
export function trustKey(folder: string): string {
  if (folder.trim().length === 0) throw new Error(`Carpeta vacia: ${JSON.stringify(folder)}`);
  const forward = normalize(folder).replace(/\\/g, '/');
  const trimmed = forward.replace(/\/+$/, '');
  // La barra final se quita SALVO en una raiz. `C:/` -> `C:` seria una ruta relativa a la unidad en
  // Windows (`C:` significa "el directorio actual de C:"), y `/` -> `` dejaria la raiz POSIX sin clave.
  // Ademas, colapsar `C:/` y `D:/` a la misma clave haria que confiar en una unidad confiara en la otra.
  return trimmed.length === 0 || trimmed.endsWith(':') ? forward : trimmed;
}

// La carpeta y todos sus padres hasta la raiz, en claves canonicas. Es lo que permite que confiar una
// vez en `C:/sourcecode` valga para los veinte repos que cuelgan de ahi, igual que hace el CLI.
export function ancestorKeys(folder: string): readonly string[] {
  const keys: string[] = [];
  // Se sube por la ruta NATIVA y solo se convierte a clave al emitir. Subir por la clave ya normalizada
  // era un bug: `resolve` interpreta `C:` (sin barra) como "el directorio actual de la unidad C:", asi
  // que el ascenso saltaba al cwd del proceso en vez de parar en la raiz — y desde ahi seguia subiendo,
  // dando por confiada cualquier carpeta que colgase del padre del cwd.
  let current = normalize(folder);
  // Tope duro ademas de la condicion de parada: una ruta con un ciclo de enlaces no puede colgar el
  // proceso principal. 64 niveles es mas hondo que cualquier arbol real.
  for (let i = 0; i < 64; i += 1) {
    keys.push(trustKey(current));
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return keys;
}

// Comparacion insensible a mayusculas: en Windows `C:/Repo` y `c:/repo` son la MISMA carpeta, y una
// confianza que no se reconoce a si misma segun como se escribiera la ruta no es una confianza.
function sameKey(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// Confia esta carpeta, o cualquiera de sus padres, en `trusted`?
// Las entradas guardadas se normalizan AQUI, no se dan por buenas. Vienen de dos sitios que no
// comparten este codigo —los ajustes, que escribe el renderer con la ruta tal cual la dio el selector
// de carpeta (con barras invertidas en Windows), y el config del CLI—, y una confianza que no se
// reconoce a si misma segun quien la escribiera no sirve de nada.
export function isTrusted(folder: string, trusted: readonly string[]): boolean {
  const keys = ancestorKeys(folder);
  return trusted.some((entry) => entry.trim().length > 0 && keys.some((key) => sameKey(key, trustKey(entry))));
}

// Anade la carpeta a la lista, sin duplicar. Devuelve la MISMA referencia si ya estaba cubierta: quien
// llama puede usar eso para no reescribir el fichero de ajustes por nada.
export function withTrusted(folder: string, trusted: readonly string[]): readonly string[] {
  if (isTrusted(folder, trusted)) return trusted;
  return [...trusted, trustKey(folder)];
}

export interface CliTrustDeps {
  readonly readFile: (path: string) => string;
  readonly exists: (path: string) => boolean;
}

// Carpetas que el usuario YA autorizo en el CLI, leidas de su config global (`<configDir>/.claude.json`,
// clave `projects[<ruta>].hasTrustDialogAccepted`). Solo LECTURA, y a proposito: ese fichero lo escribe
// el CLI con tmp+rename mientras corre y ademas guarda `oauthAccount`; Mage no lo toca ni lo emite —
// de aqui salen claves de carpeta y nada mas.
//
// Sirve para no volver a preguntar lo que el usuario ya contesto. Tolerante por diseño: sin fichero,
// con JSON roto o con una forma que no encaja, devuelve [] y se pregunta, que es el lado seguro.
export function readCliTrustedFolders(configDir: string, deps: CliTrustDeps): readonly string[] {
  const path = `${configDir.replace(/[\\/]+$/, '')}/.claude.json`;
  if (!deps.exists(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFile(path));
  } catch {
    // Se traga a proposito y es la unica excepcion honesta aqui: un `.claude.json` a medio escribir es
    // un estado NORMAL (el CLI lo reescribe entero), no un error del que informar. El coste de fallar
    // es preguntar una vez de mas.
    return [];
  }
  return trustedProjectKeys(parsed);
}

// Extraccion segura: recorre `projects` y se queda con las claves cuya `hasTrustDialogAccepted` es
// exactamente `true`. Nunca mira ningun otro campo del fichero.
export function trustedProjectKeys(config: unknown): readonly string[] {
  if (!isRecord(config)) return [];
  const projects = config.projects;
  if (!isRecord(projects)) return [];
  return Object.entries(projects)
    .filter(([, value]) => isRecord(value) && value.hasTrustDialogAccepted === true)
    .map(([key]) => trustKey(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
