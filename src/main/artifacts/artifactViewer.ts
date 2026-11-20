import { ARTIFACT_VIEWER_SESSION_ID } from '@shared/artifactLibrary';
import type { BrowserHandle, BrowserRegistry } from '../browser/browserRegistry';
import type { ArtifactReader } from './artifactReader';

// Visor de artifacts: la MISMA maquina del navegador integrado (`IsolatedBrowser`: particion en memoria, sin cookies,
// endurecido), registrada en el `BrowserRegistry` con un id reservado en vez del de una sesion viva. Asi la barra, la
// colocacion de la vista y la IPC del navegador valen tal cual, y no hace falta ninguna conversacion abierta.
//
// Un visor a la vez. Su raiz de ficheros es la carpeta de cache del artifact abierto: abrir otro cierra el navegador
// anterior (su raiz era otra) y cerrar el visor libera la vista.

export interface ArtifactViewerDeps {
  readonly reader: Pick<ArtifactReader, 'ensureCached'>;
  // Perezoso: el registro tambien depende del visor (para saber si su entrada sigue viva).
  readonly registry: () => Pick<BrowserRegistry, 'open' | 'close'>;
  readonly createBrowser: (instanceId: string, root: string) => BrowserHandle;
  readonly toFileUrl: (filePath: string) => string;
}

export interface OpenedArtifact {
  readonly title: string;
}

export class ArtifactViewer {
  private root: string | null = null;
  // Cada apertura saca un numero; si mientras se descarga llega otra, la vieja no toca el visor (gana la ultima).
  private latest = 0;

  constructor(private readonly deps: ArtifactViewerDeps) {}

  // ¿Sigue vivo el visor? El registro lo pregunta como pregunta si una sesion sigue viva.
  isOpen(): boolean {
    return this.root !== null;
  }

  // La entrada del registro para el visor, con la raiz del artifact abierto.
  createBrowser(instanceId: string): BrowserHandle {
    if (this.root === null) throw new Error(`El visor de artifacts no tiene ningun artifact que abrir (${instanceId})`);
    return this.deps.createBrowser(instanceId, this.root);
  }

  async open(accountId: string, id: string): Promise<OpenedArtifact> {
    const ticket = ++this.latest;
    const cached = await this.deps.reader.ensureCached(accountId, id);
    if (ticket !== this.latest) return { title: cached.title };
    await this.deps.registry().close(ARTIFACT_VIEWER_SESSION_ID);
    this.root = cached.root;
    const handle = this.deps.registry().open(ARTIFACT_VIEWER_SESSION_ID);
    await handle.navigate(this.deps.toFileUrl(cached.entryPath));
    return { title: cached.title };
  }

  // El registro cerro la entrada del visor (boton cerrar, pantalla cerrada o barrido).
  forget(): void {
    this.root = null;
  }
}
