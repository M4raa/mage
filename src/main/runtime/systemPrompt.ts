// Prompt de sistema del runtime propio. CORTO a proposito (menos de 400 tokens sin las notas del
// proyecto): los modelos pequeños se pierden con prompts largos. En ingles porque es el idioma en el que
// mejor siguen instrucciones; responden en el del usuario. PURO.

export interface SystemPromptInput {
  readonly cwd: string;
  readonly platform: string; // process.platform
  // Nombre literal de la shell que ejecuta `Bash` (p.ej. «Git Bash», «PowerShell»): sin el, un modelo
  // escribe bash en PowerShell. null = no hay herramienta de comandos.
  readonly shellName: string | null;
  readonly nowIso: string; // fecha en UTC
  readonly toolNames: readonly string[];
  // Sin herramientas nativas (modo solo chat): como escribirlas para que Mage las ejecute (R9). null = nada.
  readonly textToolGuide?: string | null;
  // Primer `AGENTS.md`/`CLAUDE.md` del cwd, ya recortado (ficha D16). null = no hay.
  readonly projectNotes: { readonly file: string; readonly text: string } | null;
  readonly projectInstructions?: string;
}

const OS_NAMES: Readonly<Record<string, string>> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

export function buildSystemPrompt(input: SystemPromptInput): string {
  const lines = [
    'You are a coding agent running inside Mage, a desktop app. You help the user with their project.',
    `Working directory: ${input.cwd}`,
    `OS: ${OS_NAMES[input.platform] ?? input.platform}. Date (UTC): ${input.nowIso.slice(0, 10)}.`,
    ...(input.shellName === null ? [] : [`The Bash tool runs commands with ${input.shellName}; write commands for that shell.`]),
    toolsLine(input),
    ...(input.toolNames.length === 0
      ? []
      : [
          'Rules: read a file before editing it. Edit needs an old_string that appears exactly once; include enough surrounding lines.',
          'Never invent paths: use Glob or Grep to find files. Paths may be relative to the working directory.',
        ]),
    'Be concise. Answer in the language the user writes in.',
  ];
  if (input.projectNotes !== null) {
    lines.push('', `Project notes (${input.projectNotes.file}):`, input.projectNotes.text);
  }
  if (input.projectInstructions) lines.push('', 'Mage project instructions:', input.projectInstructions);
  return lines.join('\n');
}

function toolsLine(input: SystemPromptInput): string {
  if (input.toolNames.length > 0) return `Tools: ${input.toolNames.join(', ')}. Call them through the tool interface, never by writing the call as text.`;
  return input.textToolGuide ?? 'You have no tools in this conversation: answer with text only.';
}

// Recorta las notas del proyecto a un tope de caracteres, marcando el corte. ponytail: corta por
// caracteres, no por tokens (chars/4 basta para no reventar una ventana de 4k).
export function trimProjectNotes(text: string, maxChars: number): string {
  if (maxChars <= 0) throw new Error(`Tope de notas del proyecto invalido: ${maxChars}`);
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}\n[… notas recortadas …]`;
}
