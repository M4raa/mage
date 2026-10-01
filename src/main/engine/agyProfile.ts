import { join } from 'node:path';
import type { ImageAttachment } from '@shared/ipc';
import { EMPTY_AGY_COMMAND_RULES, type AgyCommandRules } from '@shared/agyRules';

// Perfil propio (`USERPROFILE`) con el que Mage lanza agy: uno por cuenta de agy POR CLAVE (M12) y uno
// para la SUSCRIPCION (grupo E, fase 2), asi las reglas de Mage nunca tocan el settings.json de agy del
// usuario. Todo MEDIDO en agy 1.2.14 (`node spike/agy-spike.mjs --permissions`, `--persistent` y
// `--profile`):
//   - agy resuelve su casa SOLO por `USERPROFILE` y crea ahi `.gemini/antigravity-cli/`;
//   - su login de suscripcion NO vive ahi: en un perfil aislado sin `modelProvider` sigue autenticado
//     (`/usage` trae sus cuotas); con `modelProvider: "gemini"` y `GEMINI_API_KEY` pasa a modo clave y
//     NO cae a la suscripcion;
//   - en un perfil aislado se deniega incluso escribir en el workspace salvo regla `write_file(<cwd>)`
//     (ni `trustedWorkspaces` ni `allowNonWorkspaceAccess` lo desbloquean), asi que es imprescindible;
//   - leer FUERA del workspace (las imagenes adjuntas) tambien se deniega salvo `read_file(<dir>)`, que
//     actua como prefijo de ruta. OJO: la regla tiene que llevar la ruta LARGA: con la forma 8.3 de
//     Windows (`DMARAT~1`) no casa. Quien llama pasa rutas ya resueltas con `realpathSync.native`;
//   - para llamar a una tool MCP agy lee antes su esquema en `<perfil>/.gemini/antigravity-cli/mcp/` con
//     view_file: sin `read_file(<esa carpeta>)` se deniega (y la llamada en si pide `mcp(<srv>/<tool>)`);
//   - las reglas se leen SOLO al lanzar: que dos pestañas compartan el fichero no les cambia nada a mitad.
// Lo que se enlaza en el perfil (`.gemini/config`, `.ssh`…) lo hace agyProfileLinks.ts.

const SETTINGS_PARTS = ['.gemini', 'antigravity-cli'] as const;
const SETTINGS_FILE = 'settings.json';
const MCP_SCHEMAS_DIR = 'mcp';
const GEMINI_PROVIDER = 'gemini';

// Reglas que se suman a las imprescindibles, ya en el formato de agy (`command(<linea exacta>)`).
export type AgyProfileRules = AgyCommandRules;

export const NO_EXTRA_RULES: AgyProfileRules = EMPTY_AGY_COMMAND_RULES;

export type AgyProfileMode = 'api-key' | 'subscription';

export interface AgyProfileSettingsInput {
  readonly mode: AgyProfileMode;
  readonly profileDir: string; // ruta LARGA del perfil
  readonly cwd: string; // ruta LARGA de la carpeta de trabajo
  readonly attachmentsDir: string; // donde Mage deja las imagenes del mensaje (las abre con view_file)
  readonly extra?: AgyProfileRules;
}

// El settings.json del CLI en un perfil de Mage. Solo la cuenta por clave lleva `modelProvider`: sin el,
// agy usa su login de suscripcion.
export function agyProfileSettings(input: AgyProfileSettingsInput): Record<string, unknown> {
  if (input.cwd.trim().length === 0) throw new Error(`Carpeta de trabajo vacia para el perfil de agy: ${JSON.stringify(input.cwd)}`);
  if (input.profileDir.trim().length === 0) throw new Error(`Perfil de agy vacio: ${JSON.stringify(input.profileDir)}`);
  const extra = input.extra ?? NO_EXTRA_RULES;
  const mcpSchemas = join(input.profileDir, ...SETTINGS_PARTS, MCP_SCHEMAS_DIR);
  const permissions = {
    allow: [`write_file(${input.cwd})`, `read_file(${input.attachmentsDir})`, `read_file(${mcpSchemas})`, ...extra.allow],
    deny: [...extra.deny],
  };
  return input.mode === 'api-key' ? { modelProvider: GEMINI_PROVIDER, permissions } : { permissions };
}

export interface AgyProfileFs {
  readonly mkdir: (path: string) => void;
  readonly writeFile: (path: string, content: string) => void;
}

// Escribe el settings.json del perfil. Se reescribe en CADA lanzamiento: el cwd cambia de una pestaña a
// otra, y el fichero es de Mage (nunca el del usuario: el perfil vive en la carpeta de Mage).
export function writeAgyProfileSettings(fs: AgyProfileFs, profileDir: string, settings: Record<string, unknown>): string {
  const dir = join(profileDir, ...SETTINGS_PARTS);
  fs.mkdir(dir);
  const path = join(dir, SETTINGS_FILE);
  fs.writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

const EXTENSION_BY_TYPE: Readonly<Record<ImageAttachment['mediaType'], string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Ruta de la imagen `index` de un mensaje de la sesion. Solo letras, numeros y guiones del id: es una
// ruta que se construye con algo que viene de fuera.
export function agyAttachmentPath(attachmentsDir: string, sessionId: string, attachment: ImageAttachment, index: number): string {
  const safeSession = sessionId.replace(/[^A-Za-z0-9-]/g, '_');
  const name = `${Date.now()}-${index + 1}.${EXTENSION_BY_TYPE[attachment.mediaType]}`;
  return join(attachmentsDir, safeSession, name);
}
