import { readdirSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { resolveToolPath, type PathScope } from './tools/pathGuard';

export interface ShellWord {
  readonly value: string;
  // Compatibilidad con rutas absolutas de Windows en comandos del shell nativo existente.
  readonly windowsValue: string;
  // Por carácter: un comodín solo se activa fuera de comillas y sin escape.
  readonly unquoted: readonly boolean[];
}

// Palabras POSIX: las comillas delimitan segmentos de una palabra, no palabras nuevas. No evaluamos
// variables, sustituciones ni llaves: Auto ya pregunta por ellas antes de ejecutar el comando.
export function shellWords(command: string): ShellWord[][] | null {
  const segments: ShellWord[][] = [];
  let words: ShellWord[] = [];
  let value = '', windowsValue = '';
  let unquoted: boolean[] = [];
  let quote: "'" | '"' | null = null;
  let started = false;
  const append = (char: string, active: boolean, windows = char): void => {
    value += char; windowsValue += windows; unquoted.push(active);
  };
  const flushWord = (): void => {
    if (started) words.push({ value, windowsValue, unquoted });
    value = ''; windowsValue = ''; unquoted = []; started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (quote !== null) {
      if (char === quote) { quote = null; continue; }
      if (quote === '"' && char === '\\' && /["\\$`\n]/.test(command[i + 1] ?? '')) {
        const next = command[++i]!;
        if (next !== '\n') append(next, false);
      } else append(char, false);
      continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (char === '\\') {
      const next = command[++i];
      if (next === undefined) return null;
      if (next !== '\n') { started = true; append(next, false, '\\' + next); }
      continue;
    }
    if (/[;|&\n\r]/.test(char)) {
      flushWord(); if (words.length > 0) segments.push(words); words = []; continue;
    }
    if (/\s/.test(char) || char === '<' || char === '>') { flushWord(); continue; }
    started = true; append(char, true);
  }
  if (quote !== null) return null;
  flushWord(); if (words.length > 0) segments.push(words);
  return segments;
}

const literal = (char: string): string => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Subconjunto acotado: * ? y clases simples por nivel. Globstar, clases POSIX/locales, sintaxis
// incompleta o expansión demasiado grande son desconocidos y obligan a preguntar.
function componentPattern(value: string, unquoted: readonly boolean[], caseInsensitive: boolean): RegExp | null {
  let pattern = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (!unquoted[i] || !'*?[]'.includes(char)) { pattern += literal(char); continue; }
    if (char === '*') {
      if (value[i + 1] === '*' && unquoted[i + 1]) return null;
      pattern += '.*';
    } else if (char === '?') pattern += '.';
    else if (char === '[') {
      const end = value.indexOf(']', i + 1);
      if (end < 0 || !unquoted[end]) return null;
      const content = value.slice(i + 1, end);
      if (!/^!?[a-zA-Z0-9_ -]+$/.test(content) || unquoted.slice(i + 1, end).some(active => !active)) return null;
      pattern += '[' + (content.startsWith('!') ? '^' + content.slice(1) : content) + ']'; i = end;
    } else return null;
  }
  try { return new RegExp('^' + pattern + '$', caseInsensitive ? 'i' : ''); } catch { return null; }
}

// Expansión mínima por niveles, sin fs.globSync ni dependencia de su disponibilidad/estabilidad.
// null significa «no puedo garantizar la expansión»: el gate pregunta. También se clasifica cada
// prefijo antes de recorrerlo, para no enumerar a ciegas el destino de un enlace externo.
export function expandShellWord(word: ShellWord, scope: PathScope): readonly string[] | null {
  const active = word.unquoted.some((flag, i) => flag && '*?[]'.includes(word.value[i]!));
  if (!active) return [word.value];
  if (scope.realpath === undefined || (scope.readDirectory === undefined && scope.platform !== process.platform)) return null;
  const api = scope.platform === 'win32' ? win32 : posix;
  const root = api.parse(word.value).root;
  const start = root.length;
  const rest = word.value.slice(start);
  const parts = rest.split(scope.platform === 'win32' ? /[\\/]/ : /\//);
  let offset = start;
  let candidates = [root || scope.cwd];
  let budget = 10000;
  const readDirectory = scope.readDirectory ?? ((dir: string) => readdirSync(dir));
  try {
    for (const part of parts) {
      const flags = word.unquoted.slice(offset, offset + part.length); offset += part.length + 1;
      if (part.length === 0) continue;
      const wildcard = flags.some((flag, i) => flag && '*?[]'.includes(part[i]!));
      const pattern = wildcard ? componentPattern(part, flags, scope.platform === 'win32') : null;
      if (wildcard && pattern === null) return null;
      const next: string[] = [];
      for (const dir of candidates) {
        if (resolveToolPath(dir, scope).pathClass === 'outside') return null;
        if (!wildcard) { next.push(api.resolve(dir, part)); continue; }
        const names = readDirectory(dir);
        budget -= names.length;
        if (budget < 0) return null;
        // Incluye nombres ocultos como sobreaproximación segura ante dotglob.
        for (const name of names) if (pattern!.test(name)) next.push(api.join(dir, name));
        if (next.length > 2000) return null;
      }
      candidates = next;
    }
    return candidates;
  } catch { return null; } // EACCES, ENOTDIR, árbol cambiante: preguntar, nunca autorizar por omisión.
}
