import { join } from 'node:path';
import type { ImageAttachment } from '@shared/ipc';

// Perfil propio (`USERPROFILE`) de una cuenta de agy por clave de API (M12) y ficheros que Mage le deja
// a agy. Todo MEDIDO en agy 1.2.14 (`node spike/agy-spike.mjs --permissions` y `--persistent`):
//   - agy resuelve su casa SOLO por `USERPROFILE` y crea ahi `.gemini/antigravity-cli/`;
//   - con `modelProvider: "gemini"` en ese settings.json y `GEMINI_API_KEY` pasa a modo clave y NO cae
//     a la suscripcion;
//   - en un perfil aislado se deniega incluso escribir en el workspace salvo regla `write_file(<cwd>)`
//     (ni `trustedWorkspaces` ni `allowNonWorkspaceAccess` lo desbloquean), asi que es imprescindible;
//   - leer FUERA del workspace (las imagenes adjuntas) tambien se deniega salvo `read_file(<dir>)`, que
//     actua como prefijo de ruta (medido el 2026-10-01). OJO: la regla tiene que llevar la ruta LARGA:
//     con la forma 8.3 de Windows (`DMARAT~1`) no casa y se sigue denegando. Quien llama pasa rutas ya
//     resueltas con `realpathSync.native`.
// Nada mas se copia ni se enlaza: QUE se enlaza en el perfil (`~/.gemini/config`, `~/.ssh`…) es M14, y
// las reglas allow/deny de comandos que concede el usuario son M10/M15. Las dos esperan decision; su
// costura es `extra` (vacio hoy) y este mismo modulo.

const SETTINGS_PARTS = ['.gemini', 'antigravity-cli'] as const;
const SETTINGS_FILE = 'settings.json';
const GEMINI_PROVIDER = 'gemini';

// Reglas que se suman a las imprescindibles. `command(…)` casa la linea EXACTA (o `command(regex:…)`),
// medido; el formato que ofrezca la UI es M15.
export interface AgyProfileRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export const NO_EXTRA_RULES: AgyProfileRules = { allow: [], deny: [] };

// El settings.json del CLI en el perfil de una cuenta por clave. `attachmentsDir` es donde Mage deja las
// imagenes del mensaje: el agente tiene que poder leerlas con `view_file`.
export function agyApiProfileSettings(cwd: string, attachmentsDir: string, extra: AgyProfileRules = NO_EXTRA_RULES): Record<string, unknown> {
  if (cwd.trim().length === 0) throw new Error(`Carpeta de trabajo vacia para el perfil de agy: ${JSON.stringify(cwd)}`);
  return {
    modelProvider: GEMINI_PROVIDER,
    permissions: {
      allow: [`write_file(${cwd})`, `read_file(${attachmentsDir})`, ...extra.allow],
      deny: [...extra.deny],
    },
  };
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
