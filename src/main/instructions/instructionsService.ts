import { join } from 'node:path';
import type { InstructionsFile } from '@shared/ipc';
import { inspectBridge, type BridgeSpec } from './instructionsBridge';

// Lectura de las INSTRUCCIONES que el CLI aplica a una conversacion (2.9.b): el `CLAUDE.md` del
// PROYECTO (`<cwd>/CLAUDE.md`) y el del USUARIO (`<configDir>/CLAUDE.md`).
//
// Ojo a una afirmacion que circulaba y NO era cierta: Mage no leia `CLAUDE.md` en ningun sitio — lo lee
// el CLI. Esta vista necesitaba fontaneria nueva entera, no exponer algo que ya existiera.
//
// DELIBERADAMENTE CORTO: sin recursion por directorios padre, sin globs y sin resolver `@imports`. Eso
// lo hace el CLI con sus propias reglas, y reimplementarlas aqui seria enseñar algo que no coincide con
// lo que el agente recibe de verdad — peor que no enseñar nada.

export interface InstructionsDeps {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  // Puente de instrucciones (grupo H): que cuenta como fichero propio del CLI de ese proveedor y cuenta;
  // null = el proveedor no lleva puente (Claude lee su CLAUDE.md). Ausente = nunca hay puente.
  readonly bridgeSpecFor?: (provider: string, accountDir: string) => BridgeSpec | null;
  // Carpeta del CLAUDE.md global que se puentea (la de la cuenta de Claude por defecto).
  readonly claudeUserDir?: string;
}

export class InstructionsService {
  constructor(private readonly deps: InstructionsDeps) {}

  // Los dos ficheros, siempre en el mismo orden (proyecto primero). `content: null` = no existe, que NO
  // es un error: la mayoria de los proyectos no tienen `CLAUDE.md`. Un fichero VACIO devuelve `''`, que
  // es distinto (existe y esta vacio) — la misma distincion que ya paga el compare-and-swap.
  read(params: { readonly cwd: string; readonly accountDir: string; readonly provider?: string }): readonly InstructionsFile[] {
    const spec = params.provider === undefined ? null : (this.deps.bridgeSpecFor?.(params.provider, params.accountDir) ?? null);
    if (spec !== null && this.deps.claudeUserDir !== undefined) return this.readBridged(params.cwd, this.deps.claudeUserDir, spec);
    return [
      this.readOne('project', join(params.cwd, 'CLAUDE.md')),
      this.readOne('user', join(params.accountDir, 'CLAUDE.md')),
    ];
  }

  // Codex y agy no leen CLAUDE.md: se enseñan los que Mage les PUENTEA, con el mismo calculo que el
  // lanzamiento (instructionsBridge.ts), para que la vista diga lo que el agente recibe de verdad.
  private readBridged(cwd: string, claudeUserDir: string, spec: BridgeSpec): readonly InstructionsFile[] {
    return inspectBridge(this.deps, { cwd, claudeUserDir, spec }).map(({ scope, path, content, ownFile }) => ({
      scope,
      path,
      content,
      bridge: { target: spec.target, ownFile },
    }));
  }

  private readOne(scope: InstructionsFile['scope'], path: string): InstructionsFile {
    if (!this.deps.exists(path)) return { scope, path, content: null };
    // Sin `catch { return null }`: un fallo de lectura que NO es "no existe" (permisos, disco) es un
    // error de verdad y tiene que llegar al usuario, no disfrazarse de "no hay fichero".
    return { scope, path, content: this.deps.readFile(path) };
  }
}
