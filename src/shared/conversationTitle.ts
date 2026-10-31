// Marcadores que guardaron versiones anteriores (0.1.2 y antes) en workspaces e índices: se leen como
// "sin título". Desde F3.3 el marcador es el título vacío y se pinta con `tabs.untitled` en el idioma activo.
const LEGACY_UNTITLED_TITLES: ReadonlySet<string> = new Set(['Nuevo chat', 'Nueva conversación']);

// True si el título es el vacío o un marcador antiguo: el primer prompt puede reemplazarlo.
export function isPlaceholderTitle(title: string): boolean {
  return title.trim().length === 0 || LEGACY_UNTITLED_TITLES.has(title);
}
