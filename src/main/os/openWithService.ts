import { basename } from 'node:path';
import {
  buildOpenEditorCommand,
  buildOpenTerminalCommand,
  buildPrivateBrowserCommand,
  EDITOR_CANDIDATES,
  privateBrowserCandidates,
} from './openTargets';
import type { EditorCandidate } from './openTargets';

// Dependencias inyectables (SO/FS) -> testable sin tocar electron ni el disco.
export interface OpenWithDeps {
  readonly reveal: (path: string) => void; // revelar en el gestor de archivos (shell.showItemInFolder)
  readonly showSaveDialog: (defaultName: string) => Promise<string | null>; // ruta elegida o null si cancela
  readonly copyFile: (src: string, dest: string) => void;
  readonly fileExists: (path: string) => boolean;
  // Abre una ruta (carpeta o archivo) con la app por defecto del SO. Devuelve "" si OK, o el mensaje
  // de error del SO (contrato de shell.openPath de Electron). Cross-platform sin ramas por SO.
  readonly openPath: (path: string) => Promise<string>;
  // Abre una URL en el NAVEGADOR del usuario (shell.openExternal). Distinta de openPath: aquella
  // resuelve rutas del disco, esta un esquema de red.
  readonly openExternal: (url: string) => Promise<void>;
  // SO actual (para elegir el comando de terminal) y lanzador detached de un proceso con su cwd.
  readonly platform: NodeJS.Platform;
  readonly spawnDetached: (command: string, args: readonly string[], cwd: string) => void;
  // Disponibilidad de un comando en el PATH (where/which). Para detectar editores instalados.
  readonly isCommandAvailable: (bin: string) => boolean;
  // Variables del SO. Solo se leen las rutas de instalacion de navegadores (ProgramFiles y demas):
  // inyectadas, no leidas de `process.env` dentro, para poder probar los tres SO sin tocar el real.
  readonly env: Readonly<Record<string, string | undefined>>;
}

// Capa de SO para "abrir con": revelar un archivo en el gestor del sistema y guardarlo (copiar) a
// una ubicacion elegida por el usuario. Toda diferencia por SO queda tras esta abstraccion.
export class OpenWithService {
  constructor(private readonly deps: OpenWithDeps) {}

  // Revela el archivo en el explorador/Finder/gestor. Precondicion: el archivo existe.
  reveal(path: string): void {
    this.ensureExists(path);
    this.deps.reveal(path);
  }

  // Abre un dialogo "Guardar como" y copia el archivo al destino. Devuelve false si se cancela.
  async saveAs(path: string): Promise<boolean> {
    this.ensureExists(path);
    const dest = await this.deps.showSaveDialog(basename(path));
    if (dest === null) return false; // cancelado por el usuario
    this.deps.copyFile(path, dest);
    return true;
  }

  // Abre una carpeta o archivo con la app por defecto del SO (M2.3, "Open with"): p.ej. la carpeta
  // del proyecto en el explorador/Finder. Lanza si el SO devuelve error (ruta inexistente, sin app).
  async openPath(path: string): Promise<void> {
    if (path.trim().length === 0) throw new Error(`Ruta vacia para abrir: ${JSON.stringify(path)}`);
    const error = await this.deps.openPath(path);
    if (error.length > 0) throw new Error(`No se pudo abrir la ruta "${path}": ${error}`);
  }

  // Abre una URL en el navegador del usuario (Ronda 3, item 20: el badge de estado de Claude lleva a
  // status.claude.com). PRECONDICION EXPLICITA: solo https. Es una frontera publica que cruza desde el
  // renderer, y `shell.openExternal` ejecuta el manejador de protocolo que el SO tenga registrado — un
  // `file://` abriria un fichero local y esquemas como `javascript:`/`ms-msdt:` han sido vectores
  // reales de ejecucion. Que hoy solo se llame con una constante fija no es una garantia: la garantia
  // es esta comprobacion.
  async openExternal(url: string): Promise<void> {
    if (!isHttpsUrl(url)) throw new Error(`Solo se pueden abrir URLs https: ${JSON.stringify(url)}`);
    await this.deps.openExternal(url);
  }

  // Abre `url` en una ventana PRIVADA del navegador (Fase 9.2, alta de cuenta). Devuelve como se
  // abrio, y ese valor IMPORTA: 'normal' significa que no se encontro ningun navegador con bandera de
  // sesion limpia y se cayo al navegador por defecto, donde una sesion ya iniciada autorizaria la
  // cuenta equivocada. Nunca se falla el login por esto — se abre igual y la UI avisa.
  //
  // Toda la diferencia por SO vive aqui dentro (catalogo + banderas en `openTargets`), nunca en el
  // punto de llamada: es la regla multiplataforma del proyecto.
  async openPrivate(url: string): Promise<'private' | 'normal'> {
    if (!isHttpsUrl(url)) throw new Error(`Solo se pueden abrir URLs https: ${JSON.stringify(url)}`);
    const candidate = privateBrowserCandidates(this.deps.platform, this.deps.env).find((entry) =>
      this.isInstalled(entry.path),
    );
    if (candidate === undefined) {
      await this.deps.openExternal(url);
      return 'normal';
    }
    const plan = buildPrivateBrowserCommand(candidate, url);
    try {
      // `cwd` del proceso actual: al navegador le da igual, y evita inventar un directorio.
      this.deps.spawnDetached(plan.command, plan.args, process.cwd());
      return 'private';
    } catch {
      // El binario existia pero no arranco (permisos, instalacion rota). Mejor el navegador por
      // defecto con aviso que dejar al usuario sin poder dar de alta la cuenta.
      await this.deps.openExternal(url);
      return 'normal';
    }
  }

  // Abre una terminal del SO en `cwd` (M2.3). El directorio se aplica por la opcion `cwd` del spawn
  // (evita el escapado de comillas); en macOS el comando ya lleva el path como argumento.
  openTerminal(cwd: string): void {
    if (cwd.trim().length === 0) throw new Error(`cwd vacio para abrir terminal: ${JSON.stringify(cwd)}`);
    const plan = buildOpenTerminalCommand(this.deps.platform, cwd);
    this.deps.spawnDetached(plan.command, plan.args, cwd);
  }

  // Editores del catalogo presentes en el PATH de la maquina (M2.3, "Abrir en <editor>").
  listAvailableEditors(): readonly EditorCandidate[] {
    return EDITOR_CANDIDATES.filter((candidate) => this.deps.isCommandAvailable(candidate.bin));
  }

  // Abre la carpeta `cwd` en el editor `bin` (uno de los detectados). El builder puro encapsula la
  // diferencia por SO (shims .cmd en Windows via `cmd /c`).
  openEditor(bin: string, cwd: string): void {
    // `EDITOR_CANDIDATES` existia y solo se usaba para LISTAR: el bin volvia del renderer y se
    // pasaba tal cual a `cmd /c` en Windows, donde cmd reparsea `&` y ejecuta lo que venga detras.
    // Hoy el unico llamante manda un bin de la lista, asi que no es explotable sin un XSS previo en
    // nuestro propio renderer — pero esto es una FRONTERA de confianza y el estandar del repo obliga
    // a validar precondiciones en funciones publicas. Cuesta una linea.
    if (!EDITOR_CANDIDATES.some((candidate) => candidate.bin === bin)) {
      throw new Error(`bin de editor no permitido: ${JSON.stringify(bin)}`);
    }
    if (cwd.trim().length === 0) throw new Error(`cwd vacio para abrir editor: ${JSON.stringify(cwd)}`);
    const plan = buildOpenEditorCommand(this.deps.platform, bin, cwd);
    this.deps.spawnDetached(plan.command, plan.args, cwd);
  }

  // ¿Esta instalado el candidato? En Windows y macOS viene como ruta absoluta (los navegadores NO
  // estan en el PATH, medido en Windows el 2026-09-14); en Linux, como comando del PATH.
  private isInstalled(pathOrBin: string): boolean {
    const isPath = pathOrBin.includes('/') || pathOrBin.includes('\\');
    return isPath ? this.deps.fileExists(pathOrBin) : this.deps.isCommandAvailable(pathOrBin);
  }

  private ensureExists(path: string): void {
    if (!this.deps.fileExists(path)) throw new Error(`El archivo no existe: ${path}`);
  }
}

// ¿Es una URL https bien formada? PURO y exportado para poder probar los casos que importan (esquemas
// raros, mayusculas, cadenas que no parsean). `new URL` no lanza nunca hacia fuera: aqui se traduce a
// `false`, que es el contrato de esta funcion (no hay "error de parseo", hay "no es https").
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
