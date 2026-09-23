import { basename, dirname, join } from 'node:path';
import type { AccountInfo, LoginStatus } from '@shared/accounts';
import type { LogLevel } from '@shared/debug';
import type { AccountLayout } from '../engine/providerAdapter';
import type { LinkService } from '../os/linkService';
import { pathEquals } from '../os/pathUtils';
import {
  decideCredentialsConvergence,
  parseCredentialsSide,
  type CredentialsSide,
} from './credentialsConvergence';

// Carpetas que comparten TODAS las cuentas via enlace hacia ~/.claude/<name> (datos comunes).
const SHARED_FOLDERS = ['paste-cache', 'plugins', 'projects', 'sessions', 'skills', 'todos'] as const;
// Perfil privado de una cuenta (M2.6): subdir anidado con `projects` PROPIO (historial privado) y el
// MISMO login de la cuenta (hard link de .credentials.json). Anidado -> nunca se descubre como cuenta
// (discoverConfigDirs solo escanea el nivel superior de HOME).
const PRIVATE_PROFILE_DIR = 'mage-private';
// El perfil privado comparte todo lo comun MENOS `projects` (justo lo que se aisla).
const PRIVATE_SHARED_FOLDERS = SHARED_FOLDERS.filter((folder) => folder !== 'projects');
// Nombre de comando/cuenta valido al crear (letra inicial + letras/numeros/-/_).
const ACCOUNT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CREDENTIALS_FILE = '.credentials.json';
const SETTINGS_FILE = 'settings.json';
// Caracteres a escapar para meter el nombre del dir principal dentro de una RegExp.
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

// Deriva el patron de dirs de cuenta del nombre del dir principal: `<main>`, `<main>-<algo>` y
// `<main><digitos>` (las tres formas que crea el CLI en disco). Se DERIVA en vez de declararse para
// que no puedan divergir: un layout con patron propio acabaria descubriendo dirs que createAccount
// no sabe crear.
function accountDirPattern(mainDirName: string): RegExp {
  return new RegExp(`^${mainDirName.replace(REGEXP_SPECIALS, '\\$&')}(-.*|\\d*)$`);
}
// Modelo semilla para settings.json de una cuenta nueva (default conceptual de la app).
const DEFAULT_SEED_MODEL = 'sonnet';

// Dependencias inyectables (FS/reloj/enlaces) -> modulo puro y testable con mocks.
export interface AccountDeps {
  // Layout de cuentas del proveedor, declarado por su ProviderAdapter (9.1). Antes estaba cableado
  // aqui dentro y era lo que dejaba a `agy` y al gateway sin multicuenta.
  readonly layout: AccountLayout;
  readonly homedir: string;
  readonly listHome: () => string[]; // nombres de entradas en HOME
  readonly isDirectory: (path: string) => boolean;
  readonly exists: (path: string) => boolean;
  readonly readJson: (path: string) => unknown; // null si no existe/ilegible/JSON invalido
  readonly mkdir: (path: string) => void;
  readonly writeFile: (path: string, content: string) => void;
  readonly rmrf: (path: string) => void; // borrado recursivo del dir de cuenta (ya sin enlaces)
  // Copia el fichero de credenciales de forma atomica y con permisos restringidos (grupo G): es como
  // se converge la cuenta con su perfil privado. Sustituye al hard link, que el CLI destruye con su
  // propio tmp+rename (ver credentialsConvergence.ts).
  readonly copyCredentialsFile: (from: string, to: string) => void;
  readonly now: () => number; // reloj inyectado (para clasificar caducidad)
  readonly linkService: LinkService;
  // Log inyectado: la convergencia de credenciales y su DIRECCION tienen que quedar registradas.
  readonly log: (level: LogLevel, message: string) => void;
}

// Descubre, describe y crea cuentas de Claude Code (cada una = un CLAUDE_CONFIG_DIR). Porta la logica
// de reference/accounts-and-usage-reference.js SIN el servidor HTTP ni la funcion de perfil de shell
// (Mage fija CLAUDE_CONFIG_DIR en el env del hijo -> el atajo por-shell es innecesario).
// SEGURIDAD: solo expone email/org/loginStatus/expiresAt/defaultModel; nunca el token, oauthAccount
// completo, userID ni machineID.
export class AccountService {
  private readonly mainDir: string;
  private readonly dirPattern: RegExp;

  constructor(private readonly deps: AccountDeps) {
    const { mainDirName } = deps.layout;
    if (mainDirName.trim().length === 0) {
      throw new Error(`El layout del proveedor no declara mainDirName: ${JSON.stringify(deps.layout)}`);
    }
    this.mainDir = join(deps.homedir, mainDirName);
    this.dirPattern = accountDirPattern(mainDirName);
  }

  // Lista todas las cuentas descubiertas, con la principal primero y el resto por nombre.
  listAccounts(): AccountInfo[] {
    return this.discoverConfigDirs()
      .map((dir) => this.describeAccount(dir))
      .sort(byMainThenName);
  }

  // Crea una cuenta nueva: dir + enlaces a las carpetas compartidas + settings.json semilla.
  createAccount(name: string): AccountInfo {
    const clean = name.trim();
    if (!ACCOUNT_NAME_PATTERN.test(clean)) {
      throw new Error(`Nombre de cuenta invalido (letra inicial + letras/numeros/-/_): "${name}"`);
    }
    const dir = join(this.deps.homedir, `${this.deps.layout.mainDirName}-${clean}`);
    if (this.deps.exists(dir)) throw new Error(`La cuenta ya existe: ${dir}`);

    this.deps.mkdir(dir);
    for (const folder of SHARED_FOLDERS) {
      this.deps.linkService.createDirLink(join(this.mainDir, folder), join(dir, folder));
    }
    this.seedSettings(dir);
    return this.describeAccount(dir);
  }

  // Elimina una cuenta: desenlaza las carpetas compartidas (SIN tocar los datos comunes) y borra su
  // directorio. Guardas de seguridad: nunca la principal, debe existir y ser un dir de cuenta gestionado
  // bajo HOME. Si algun enlace compartido no se pudo quitar, ABORTA (no arriesga los datos comunes).
  // Incluye los enlaces del PERFIL PRIVADO (mage-private/<compartida>), que tambien apuntan al comun.
  deleteAccount(configDir: string): void {
    if (this.isMainDir(configDir)) {
      throw new Error(`No se puede eliminar la cuenta principal (${this.mainDir}): ${configDir}`);
    }
    if (!this.deps.exists(configDir)) throw new Error(`La cuenta no existe: ${configDir}`);
    if (!this.isManagedAccountDir(configDir)) {
      throw new Error(`Ruta de cuenta no valida (debe ser ${this.mainDir}-* bajo HOME): ${configDir}`);
    }

    // Enlaces compartidos a limpiar: los de la cuenta y los del perfil privado (todos apuntan al
    // comun; un rmrf a ciegas sobre ellos arriesgaria los datos compartidos).
    const linkPaths = [
      ...SHARED_FOLDERS.map((folder) => join(configDir, folder)),
      ...PRIVATE_SHARED_FOLDERS.map((folder) => join(configDir, PRIVATE_PROFILE_DIR, folder)),
    ];
    for (const linkPath of linkPaths) {
      this.deps.linkService.removeDirLink(linkPath);
    }
    for (const linkPath of linkPaths) {
      if (this.deps.linkService.classifyLink(linkPath) === 'link') {
        throw new Error(`No se pudo desenlazar "${linkPath}"; se aborta el borrado para no tocar datos compartidos`);
      }
    }
    this.deps.rmrf(configDir);
  }

  // Asegura (idempotente) el PERFIL PRIVADO de una cuenta y devuelve su config dir (M2.6). El perfil
  // reutiliza el LOGIN de la cuenta (misma identidad, misma facturacion) pero tiene su propio
  // `projects/` (historial privado). Las demas carpetas comunes se enlazan al comun como en una
  // cuenta normal. Solo cuentas gestionadas o la principal.
  //
  // Las credenciales NO se comparten con un enlace: se CONVERGEN copiando el lado con el token
  // vigente sobre el otro (ver credentialsConvergence.ts). El hard link que habia aqui antes partia
  // de que el CLI reescribe el fichero in-place sobre el mismo inode; se comprobo en disco que es
  // FALSO (escribe con tmp+rename, el inode cambia y el enlace muere sin aviso).
  ensurePrivateProfile(accountConfigDir: string): string {
    const dir = accountConfigDir.trim();
    if (dir.length === 0) {
      throw new Error(`Config dir de cuenta vacio para el perfil privado: ${JSON.stringify(accountConfigDir)}`);
    }
    if (!this.isMainDir(dir) && !this.isManagedAccountDir(dir)) {
      throw new Error(
        `Ruta de cuenta no valida para perfil privado (debe ser ${this.mainDir} o ${this.mainDir}-* bajo HOME): ${dir}`,
      );
    }

    const profileDir = join(dir, PRIVATE_PROFILE_DIR);
    this.deps.mkdir(join(profileDir, 'projects')); // projects PRIVADO real (mkdir recursivo crea el perfil)
    for (const folder of PRIVATE_SHARED_FOLDERS) {
      this.deps.linkService.createDirLink(join(this.mainDir, folder), join(profileDir, folder));
    }
    this.convergeCredentials(dir, profileDir);
    this.seedSettings(profileDir);
    return profileDir;
  }

  // Adopta el login de otra cuenta: copia su fichero de credenciales sobre el de `targetConfigDir`
  // (Fase 9.2). Para quien ya usa Claude Code, su primera cuenta extra en Mage no necesita ningun
  // login: hereda la sesion de `~/.claude`.
  //
  // No es un atajo sospechoso: las dos cuentas quedan con la MISMA identidad de Anthropic, que es
  // exactamente lo que ya hace el perfil privado de una cuenta desde M2.6. Lo que cambia entre ellas
  // es el `projects/` y los ajustes, no quien factura.
  //
  // Se exige que el origen tenga una sesion USABLE (los dos tokens y un expiresAt valido). Copiar un
  // fichero vaciado por el CLI dejaria la cuenta nueva con un login que parece existir y no vale, que
  // es peor que no tener ninguno.
  adoptLogin(sourceConfigDir: string, targetConfigDir: string): void {
    const source = sourceConfigDir.trim();
    const target = targetConfigDir.trim();
    if (source.length === 0 || target.length === 0) {
      throw new Error(`Config dir vacio al adoptar login: origen "${sourceConfigDir}", destino "${targetConfigDir}"`);
    }
    if (pathEquals(source, target)) throw new Error(`El origen y el destino son la misma cuenta: ${source}`);
    for (const dir of [source, target]) {
      if (!this.isMainDir(dir) && !this.isManagedAccountDir(dir)) {
        throw new Error(`Ruta de cuenta no valida para adoptar login: ${dir}`);
      }
    }

    const side = this.readCredentialsSide(join(source, CREDENTIALS_FILE));
    if (!side.exists || !side.hasTokens || side.expiresAt === null) {
      throw new Error(`La cuenta de origen no tiene una sesion utilizable: ${source}`);
    }
    this.deps.copyCredentialsFile(join(source, CREDENTIALS_FILE), join(target, CREDENTIALS_FILE));
    this.deps.log('info', `Login adoptado: "${source}" -> "${target}"`);
  }

  // Prepara el login del config dir con el que se va a lanzar el CLI, sea cual sea el punto de
  // arranque (crear conversacion, handoff con --resume, ...). Si es un PERFIL PRIVADO converge sus
  // credenciales con las de su cuenta; si es el dir de una cuenta no hay nada que converger.
  // Idempotente. Frontera de seguridad: solo perfiles privados de cuentas gestionadas o la principal.
  ensureCredentialsFor(configDir: string): void {
    const dir = configDir.trim();
    if (dir.length === 0) {
      throw new Error(`Config dir vacio al preparar credenciales: ${JSON.stringify(configDir)}`);
    }
    if (basename(dir) !== PRIVATE_PROFILE_DIR) return;

    const accountDir = dirname(dir);
    if (!this.isMainDir(accountDir) && !this.isManagedAccountDir(accountDir)) {
      throw new Error(`Perfil privado con cuenta padre no valida: ${dir}`);
    }
    this.convergeCredentials(accountDir, dir);
  }

  // --- Interno --------------------------------------------------------------------------------

  // Converge el .credentials.json de la cuenta con el de su perfil privado, en la direccion que
  // decida el modulo puro (NUNCA una direccion fija: si fue la sesion privada la que refresco el
  // token, copiar cuenta->perfil destruiria el refresh token bueno y dejaria la cuenta sin login).
  // Se ejecuta antes de spawnear al hijo, asi que el CLI siempre arranca sobre el token vigente.
  private convergeCredentials(accountDir: string, profileDir: string): void {
    const account = this.readCredentialsSide(join(accountDir, CREDENTIALS_FILE));
    const profile = this.readCredentialsSide(join(profileDir, CREDENTIALS_FILE));
    const decision = decideCredentialsConvergence(account, profile);
    if (decision.action === 'none') {
      this.deps.log('debug', `Credenciales del perfil privado sin convergir: ${decision.reason}`);
      return;
    }
    this.deps.copyCredentialsFile(decision.from, decision.to);
    this.deps.log(
      'info',
      `Credenciales del perfil privado convergidas: "${decision.from}" -> "${decision.to}" (${decision.reason})`,
    );
  }

  // Lee un lado para la convergencia. Solo saca metadata (existe / expiresAt / si hay tokens); el
  // token en si nunca se copia a memoria ni sale de aqui.
  private readCredentialsSide(path: string): CredentialsSide {
    const exists = this.deps.exists(path);
    return parseCredentialsSide({ path, exists, json: exists ? this.deps.readJson(path) : null });
  }

  private discoverConfigDirs(): string[] {
    return this.deps
      .listHome()
      .filter((entryName) => this.dirPattern.test(entryName))
      .map((entryName) => join(this.deps.homedir, entryName))
      .filter((dir) => this.deps.isDirectory(dir));
  }

  private describeAccount(dir: string): AccountInfo {
    const isMain = this.isMainDir(dir);
    // La cuenta principal guarda su fichero de estado en HOME raiz; las alternativas dentro del dir.
    const statePath = isMain
      ? join(this.deps.homedir, this.deps.layout.stateFileName)
      : join(dir, this.deps.layout.stateFileName);
    const account = readOauthAccount(this.deps.readJson(statePath));
    const settings = this.deps.readJson(join(dir, SETTINGS_FILE));
    const login = this.resolveLoginStatus(dir);
    return {
      configDir: dir,
      name: basename(dir),
      isMain,
      email: account.email,
      org: account.org,
      loginStatus: login.status,
      expiresAt: login.expiresAt,
      defaultModel: readStringField(settings, 'model'),
    };
  }

  private resolveLoginStatus(dir: string): { status: LoginStatus; expiresAt: number | null } {
    // Se reutiliza el lector de la convergencia (el unico sitio que conoce el formato del fichero de
    // credenciales) en vez de duplicarlo aqui: saca metadata, nunca el token.
    const side = this.readCredentialsSide(join(dir, CREDENTIALS_FILE));
    if (!side.exists) return { status: 'logged_out', expiresAt: null };
    const { expiresAt } = side;
    if (expiresAt === null) return { status: 'logged_in', expiresAt: null };
    const status: LoginStatus = expiresAt < this.deps.now() ? 'expired' : 'logged_in';
    return { status, expiresAt };
  }

  // Siembra el settings.json de un dir NUEVO (cuenta recien creada o perfil privado).
  //
  // INVARIANTE (no cambiar sin leer esto): `writeFile` es una escritura PLANA (writeFileSync), que
  // trunca el fichero in situ y por tanto PRESERVA los hard links. En la maquina del usuario el
  // ~/.claude/settings.json esta hard-linkeado entre las 4 instalaciones de Claude Code; pasar esta
  // linea a la escritura atomica (tmp+rename) "por consistencia" con el resto romperia los 4 enlaces
  // en silencio. El guard de abajo (solo escribe si NO existe) es lo que hace esto seguro: sobre un
  // dir ya sembrado no se escribe nunca.
  private seedSettings(dir: string): void {
    const settingsPath = join(dir, SETTINGS_FILE);
    if (this.deps.exists(settingsPath)) return;
    // Semilla minima: solo el modelo por defecto. Sin flags de TUI/permisos (no aplican al wrapper
    // headless: Mage gestiona permisos por stdio y no usa la TUI del CLI).
    this.deps.writeFile(settingsPath, JSON.stringify({ model: DEFAULT_SEED_MODEL }, null, 2));
  }

  private isMainDir(dir: string): boolean {
    return pathEquals(dir, this.mainDir);
  }

  // Cuenta gestionada: directamente bajo HOME, con nombre de config dir y distinta de la principal.
  private isManagedAccountDir(dir: string): boolean {
    const name = basename(dir);
    return (
      this.dirPattern.test(name) &&
      pathEquals(join(this.deps.homedir, name), dir) &&
      !this.isMainDir(dir)
    );
  }
}

// --- Extraccion segura de campos (nunca lee token/userID/machineID) -----------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringField(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Extrae SOLO email y org de oauthAccount; ignora deliberadamente userID/organizationUuid/etc.
function readOauthAccount(stateJson: unknown): { email: string | null; org: string | null } {
  if (!isRecord(stateJson) || !isRecord(stateJson.oauthAccount)) {
    return { email: null, org: null };
  }
  const account = stateJson.oauthAccount;
  return {
    email: typeof account.emailAddress === 'string' ? account.emailAddress : null,
    org: typeof account.organizationName === 'string' ? account.organizationName : null,
  };
}

function byMainThenName(a: AccountInfo, b: AccountInfo): number {
  if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
  return a.name.localeCompare(b.name);
}
