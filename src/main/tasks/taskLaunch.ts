// Carpetas extra de una tarea de Claude: van como `permissions.additionalDirectories` dentro del fragmento de
// `--settings` que el adapter ya pasa, así no se toca el motor.

type Fragment = Readonly<Record<string, unknown>>;

function isPlainObject(value: unknown): value is Fragment {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function withTaskDirectories(fragment: Fragment | null, extraFolders: readonly string[]): Fragment | null {
  if (extraFolders.length === 0) return fragment;
  const base = fragment ?? {};
  const permissions = isPlainObject(base.permissions) ? base.permissions : {};
  const additionalDirectories = [...new Set([...stringsOf(permissions.additionalDirectories), ...extraFolders])];
  return { ...base, permissions: { ...permissions, additionalDirectories } };
}
