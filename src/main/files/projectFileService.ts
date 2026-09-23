import { isAbsolute, relative, resolve } from 'node:path';
import type { ProjectFileContent } from '@shared/ipc';

// Lectura y escritura de un fichero que el agente ha creado DENTRO de la carpeta de la conversacion
// (2.10, panel "Ficheros"). Es la primera vez que el renderer puede escribir un fichero cualquiera del
// proyecto, asi que la frontera es lo importante de este modulo:
//
//  1. La ruta se valida contra la carpeta de la conversacion (`cwd`) y solo se acepta si esta DENTRO,
//     o si `isAllowedOutsideCwd` la reconoce (los PLANES: el CLI los escribe en `<configDir>/plans`,
//     que no esta bajo el cwd de nadie — reporte del usuario, "¿como es que sale fuera del sitio?").
//     ALCANCE REAL de esa guarda (auditoria B.5): protege contra un `file_path` raro venido del CLI,
//     que es de donde sale la ruta en el panel. NO protege contra un renderer comprometido: el `cwd`
//     viaja en el MISMO payload IPC que el `path`, asi que quien pueda falsear uno falsea el otro y la
//     comparacion le sale a favor. Cerrar tambien esa mitad exige cruzar el `cwd` en el handler contra
//     `isFolderTrusted` —y eso pide un `accountDir` que hoy no viaja en los parametros—.
//     Se compara con `relative()` sobre rutas RESUELTAS, no con un
//     `startsWith` de cadenas: "C:\proj-otro" empieza por "C:\proj" y no esta dentro de el.
//     Quien decide esa segunda raiz es MAIN (con su whitelisting por patron), nunca un parametro que
//     venga del renderer: si la raiz viajara por IPC, el limite lo pondria justo quien debe respetarlo.
//  2. La escritura es un COMPARE-AND-SWAP por mtime, igual que la config compartida: si el fichero
//     cambio en disco desde que el panel lo leyo (lo reescribio el agente, o el usuario en su editor),
//     se rechaza en vez de pisarlo. Perder el trabajo del otro en silencio es el peor final posible.
//  3. Se limita el TAMANO de lectura: el panel es para planes y notas, y cargar un volcado de 200 MB
//     en el renderer lo congela. Un fichero mas grande se dice, no se trunca a medias en silencio.

export const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024;

export interface ProjectFileDeps {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, content: string) => void;
  // mtime en ms, o null si el fichero no existe. Es el testigo del compare-and-swap.
  readonly mtimeMs: (path: string) => number | null;
  readonly byteLength: (path: string) => number;
  // Rutas de FUERA del cwd que aun asi se abren (hoy: los planes del CLI en `<configDir>/plans`). Se
  // inyecta porque el whitelisting por patron vive en main, junto al resto de fronteras de IPC.
  readonly isAllowedOutsideCwd: (path: string) => boolean;
}

export interface ProjectFileTarget {
  readonly cwd: string;
  readonly path: string;
}

// ¿`path` cae DENTRO de `dir`? `relative` devuelve '' para el propio dir, algo que empieza por '..'
// para lo que queda fuera, y una ruta absoluta cuando estan en unidades distintas (Windows). Es lo que
// distingue "C:\proj\a.md" (dentro) de "C:\proj-otro\a.md" (fuera), que un `startsWith` confunde.
function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

export class ProjectFileService {
  constructor(private readonly deps: ProjectFileDeps) {}

  read(target: ProjectFileTarget): ProjectFileContent {
    const path = this.resolveAllowed(target);
    if (!this.deps.exists(path)) {
      // No es un caso raro: el agente pudo crear el fichero y borrarlo despues, o la conversacion se
      // reabrio en otra maquina. Se dice claro en vez de devolver un contenido vacio que se veria como
      // un fichero de verdad.
      return { path, content: null, mtimeMs: null, tooLarge: false };
    }
    const bytes = this.deps.byteLength(path);
    if (bytes > MAX_PROJECT_FILE_BYTES) {
      return { path, content: null, mtimeMs: this.deps.mtimeMs(path), tooLarge: true };
    }
    return { path, content: this.deps.readFile(path), mtimeMs: this.deps.mtimeMs(path), tooLarge: false };
  }

  // `expectedMtimeMs` es el mtime que el panel leyo (null = "no existia cuando lo lei"). Devuelve el
  // nuevo mtime para que el panel siga teniendo un testigo valido tras guardar.
  write(target: ProjectFileTarget & { readonly content: string; readonly expectedMtimeMs: number | null }): ProjectFileContent {
    const path = this.resolveAllowed(target);
    const current = this.deps.mtimeMs(path);
    if (current !== target.expectedMtimeMs) {
      throw new Error(
        `El fichero cambió en disco desde que se abrió (mtime esperado ${String(target.expectedMtimeMs)}, actual ${String(current)}): ` +
          `vuelve a cargarlo para no perder ese cambio`,
      );
    }
    this.deps.writeFile(path, target.content);
    return { path, content: target.content, mtimeMs: this.deps.mtimeMs(path), tooLarge: false };
  }

  // Precondicion compartida por las dos operaciones: ruta dentro del cwd de la conversacion o en una
  // de las raices permitidas de fuera (los planes del CLI).
  private resolveAllowed(target: ProjectFileTarget): string {
    if (target.cwd.trim().length === 0) throw new Error('Carpeta de la conversación vacía al abrir un fichero');
    if (target.path.trim().length === 0) throw new Error('Ruta de fichero vacía');
    const cwd = resolve(target.cwd);
    const path = resolve(cwd, target.path);
    if (isInside(cwd, path) || this.deps.isAllowedOutsideCwd(path)) return path;
    throw new Error(
      `El fichero no está en la carpeta de la conversación ni en los planes del CLI, así que Mage no lo abre: ${target.path}`,
    );
  }
}
