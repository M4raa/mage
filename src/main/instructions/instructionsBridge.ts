import { join } from 'node:path';

// Puente de instrucciones entre proveedores (grupo H, respuesta 38): si el proyecto solo tiene
// `CLAUDE.md` (y el usuario su `~/.claude/CLAUDE.md`), Mage se lo da a Codex como su AGENTS.md y a agy
// como su GEMINI.md en cada sesion, SIN escribir en el repo ni en la config real. Si el CLI ya tiene
// su propio fichero en ese ambito, manda el suyo y no se añade nada.
//
// Que lee cada CLI, MEDIDO (spike/codex-spike.mjs --instructions, codex-cli 0.144.4, y
// spike/agy-spike.mjs --instructions, agy 1.2.16, 2026-10-05):
//   - codex: `AGENTS.override.md`/`AGENTS.md` del proyecto (de la raiz del repo al cwd, uno por carpeta)
//     y del CODEX_HOME. NO lee CLAUDE.md, salvo con `-c project_doc_fallback_filenames=["CLAUDE.md"]`,
//     y entonces solo en la carpeta que no tenga AGENTS.md;
//   - agy: `GEMINI.md` Y `AGENTS.md` (los dos) del proyecto, y los globales `~/.gemini/{GEMINI,AGENTS}.md`
//     y `~/.gemini/config/{GEMINI,AGENTS}.md`; `~` es el perfil de Mage (USERPROFILE). No lee CLAUDE.md.
// El mecanismo de cada adapter (fallback y `developerInstructions` en codex, carpeta con `--add-dir` en
// agy) esta en codexAdapter.ts y agyAdapter.ts; aqui solo se decide QUE se puentea.
//
// DELIBERADAMENTE CORTO, como instructionsService.ts: solo `<cwd>/CLAUDE.md`, sin subir por carpetas
// padre y sin resolver `@imports` (un `@AGENTS.md` llega como texto; con la convencion recomendada el
// AGENTS.md ya existe y no hay puente).

export const CLAUDE_INSTRUCTIONS_FILE = 'CLAUDE.md';

export type BridgeTarget = 'AGENTS.md' | 'GEMINI.md';
export type BridgeScope = 'project' | 'user';

// Que cuenta como "el fichero propio" del CLI en cada ambito.
export interface BridgeSpec {
  readonly target: BridgeTarget;
  readonly projectOwnFiles: readonly string[]; // nombres dentro del cwd
  readonly userOwnPaths: readonly string[]; // rutas absolutas del global propio
}

export interface BridgeFs {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
}

export interface BridgeInput {
  readonly cwd: string;
  readonly claudeUserDir: string; // carpeta del CLAUDE.md global (la de la cuenta de Claude por defecto)
  readonly spec: BridgeSpec;
}

// Un CLAUDE.md candidato. Se puentea si existe, no esta vacio y el CLI no tiene el suyo (`ownFile`).
export interface BridgeCandidate {
  readonly scope: BridgeScope;
  readonly path: string;
  readonly content: string | null; // null = no existe
  readonly ownFile: string | null; // el fichero propio del CLI que lo hace innecesario
}

export interface BridgedFile {
  readonly scope: BridgeScope;
  readonly path: string;
  readonly content: string;
}

export function codexBridgeSpec(codexHome: string): BridgeSpec {
  const own = ['AGENTS.override.md', 'AGENTS.md'];
  return { target: 'AGENTS.md', projectOwnFiles: own, userOwnPaths: own.map((name) => join(codexHome, name)) };
}

export function agyBridgeSpec(profileDir: string): BridgeSpec {
  const own = ['GEMINI.md', 'AGENTS.md'];
  const roots = [join(profileDir, '.gemini'), join(profileDir, '.gemini', 'config')];
  return { target: 'GEMINI.md', projectOwnFiles: own, userOwnPaths: roots.flatMap((root) => own.map((name) => join(root, name))) };
}

// Los dos candidatos, siempre en el mismo orden (proyecto primero), como InstructionsService.
export function inspectBridge(fs: BridgeFs, input: BridgeInput): readonly BridgeCandidate[] {
  if (input.cwd.trim().length === 0) throw new Error(`Carpeta de trabajo vacia para el puente de instrucciones: ${JSON.stringify(input.cwd)}`);
  const projectOwn = input.spec.projectOwnFiles.map((name) => join(input.cwd, name));
  return [
    candidate(fs, 'project', join(input.cwd, CLAUDE_INSTRUCTIONS_FILE), projectOwn),
    candidate(fs, 'user', join(input.claudeUserDir, CLAUDE_INSTRUCTIONS_FILE), input.spec.userOwnPaths),
  ];
}

function candidate(fs: BridgeFs, scope: BridgeScope, path: string, ownPaths: readonly string[]): BridgeCandidate {
  // Sin `catch`: un fallo de lectura que no es "no existe" tiene que llegar al usuario.
  const content = fs.exists(path) ? fs.readFile(path) : null;
  return { scope, path, content, ownFile: ownPaths.find((own) => fs.exists(own)) ?? null };
}

export function bridgedFiles(candidates: readonly BridgeCandidate[]): readonly BridgedFile[] {
  const bridged: BridgedFile[] = [];
  for (const { scope, path, content, ownFile } of candidates) {
    if (content === null || content.trim().length === 0 || ownFile !== null) continue;
    bridged.push({ scope, path, content });
  }
  return bridged;
}

export function resolveBridge(fs: BridgeFs, input: BridgeInput): readonly BridgedFile[] {
  return bridgedFiles(inspectBridge(fs, input));
}

const SCOPE_TITLE: Readonly<Record<BridgeScope, string>> = {
  project: 'Instrucciones del proyecto',
  user: 'Instrucciones globales del usuario',
};

// Texto que recibe el CLI (GEMINI.md de agy, `developerInstructions` de codex). Lo lee el modelo.
export function bridgeDocument(files: readonly BridgedFile[]): string {
  if (files.length === 0) throw new Error('bridgeDocument sin ficheros que puentear');
  const sections = files.map((file) => `## ${SCOPE_TITLE[file.scope]} (${file.path})\n\n${file.content.trim()}`);
  const header = '# Instrucciones de CLAUDE.md\n\nMage te pasa estas instrucciones, escritas para Claude Code, porque no hay un fichero de instrucciones propio. Aplícalas igual.';
  return `${header}\n\n${sections.join('\n\n')}\n`;
}
