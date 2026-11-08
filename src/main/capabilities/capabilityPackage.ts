// Frontera de un paquete de capacidad (decisión de diseño): todo lo que llega de fuera (manifiesto, catálogo)
// pasa por `parseCapabilityPackage` antes de que nadie lo use. Se valida aquí con especial cuidado porque `relPath`
// acaba convertido en una ruta del disco: un `..`, una ruta absoluta o una unidad de Windows escribirían fuera del
// directorio de la capacidad.
import { z } from 'zod';

export const CAPABILITY_KINDS = ['skill', 'agent', 'mcp', 'hook', 'plugin'] as const;
export const CAPABILITY_ENGINES = ['claude', 'codex'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityEngine = (typeof CAPABILITY_ENGINES)[number];

const SHA256_HEX = /^[0-9a-f]{64}$/;
// Minúsculas a propósito: el id acaba en el nombre de un directorio y Windows no distingue mayúsculas.
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
// Nombre de un servidor MCP, de un plugin o de un marketplace: va como argumento a un CLI, nunca empieza por «-».
const NATIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Rama o etiqueta git de un marketplace (versión fijada). Va como argumento: nunca empieza por «-».
const MARKETPLACE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const PREVIEW_MAX_CHARS = 300;

// Una ruta relativa es segura si no puede salir del directorio al que se resuelve en ningún sistema operativo.
export function isSafeRelPath(relPath: string): boolean {
  if (relPath === '' || relPath.includes('\\') || relPath.includes(':') || relPath.startsWith('/')) return false;
  return relPath.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const sha256 = z.string().regex(SHA256_HEX);
const file = z.object({ relPath: z.string().refine(isSafeRelPath, 'relPath inseguro'), sha256 });
const mcpStdio = z.object({
  type: z.literal('mcpStdio'),
  name: z.string().regex(NATIVE_NAME),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});
const plugin = z.object({
  type: z.literal('plugin'),
  name: z.string().regex(NATIVE_NAME),
  marketplace: z.object({
    name: z.string().regex(NATIVE_NAME),
    source: z
      .string()
      .min(1)
      .refine((s) => !s.startsWith('-'), 'source no puede empezar por «-»'),
    ref: z.string().regex(MARKETPLACE_REF).optional(),
  }),
});
const native = z.discriminatedUnion('type', [mcpStdio, plugin]);
const requires = z.object({
  secrets: z.array(z.string().min(1)).optional(),
  commands: z.array(z.string().min(1)).optional(),
});

interface ConsistencyInput {
  readonly kind: CapabilityKind;
  readonly engines: readonly string[];
  readonly files: readonly { readonly relPath: string }[];
  readonly native?: { readonly type: string };
}

function checkPackageConsistency(pkg: ConsistencyInput, ctx: z.RefinementCtx): void {
  const report = (message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (new Set(pkg.engines).size !== pkg.engines.length) report('engines repetidos');
  reportDuplicatedRelPaths(pkg.files, report);
  if (pkg.kind === 'mcp' && pkg.native?.type !== 'mcpStdio') report('un paquete mcp necesita native.type mcpStdio');
  if (pkg.kind === 'plugin' && pkg.native?.type !== 'plugin') report('un paquete plugin necesita native.type plugin');
  if (pkg.kind !== 'mcp' && pkg.kind !== 'plugin' && pkg.native !== undefined) report('native solo vale para mcp o plugin');
  if ((pkg.kind === 'skill' || pkg.kind === 'agent') && pkg.files.length === 0) {
    report(`un paquete ${pkg.kind} necesita ficheros`);
  }
}

function reportDuplicatedRelPaths(files: readonly { readonly relPath: string }[], report: (message: string) => void): void {
  const seen = new Set<string>();
  for (const { relPath } of files) {
    const key = relPath.toLowerCase();
    if (seen.has(key)) report(`relPath repetido: ${relPath}`);
    seen.add(key);
  }
}

const capabilityPackage = z
  .object({
    id: z.string().regex(PACKAGE_ID),
    version: z.string().trim().min(1),
    source: z.object({ url: z.string().url(), sha256 }),
    license: z.string().trim().min(1),
    kind: z.enum(CAPABILITY_KINDS),
    engines: z.array(z.enum(CAPABILITY_ENGINES)).min(1),
    files: z.array(file),
    requires: requires.default({}),
    native: native.optional(),
  })
  .superRefine(checkPackageConsistency);

export type CapabilityPackage = z.infer<typeof capabilityPackage>;
export type NativeInstall = z.infer<typeof native>;
export type CapabilityFile = z.infer<typeof file>;

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '<raíz>'}: ${i.message}`).join('; ');
}

export function parseCapabilityPackage(raw: unknown): CapabilityPackage {
  const result = capabilityPackage.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Paquete de capacidad inválido (${describeIssues(result.error)}): ${previewValue(raw)}`);
}

// Representación acotada de un valor externo para los mensajes de error.
export function previewValue(raw: unknown): string {
  const text = JSON.stringify(raw) ?? String(raw);
  return text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS)}…` : text;
}
