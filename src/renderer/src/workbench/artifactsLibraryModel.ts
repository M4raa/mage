import type { AccountArtifacts, ArtifactPage, ArtifactPageResult } from '@shared/artifactLibrary';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';

// Lógica pura de la pantalla «Artifacts» y de la tarjeta del chat: sin React ni IPC.

// Añade una página de «Cargar más» a la lista de su cuenta y `rel`. Una lista que ya no es `ok` (o una cuenta que ya
// no está) se deja como estaba: la página llegó tarde y no tiene a quién pegarse.
export function withMorePage(entries: readonly AccountArtifacts[], page: ArtifactPage): readonly AccountArtifacts[] {
  return entries.map((entry) => {
    if (entry.accountId !== page.accountId) return entry;
    const current = entry[page.rel];
    if (!current.ok) return entry;
    const merged: ArtifactPageResult = {
      ok: true,
      page: { ...current.page, items: [...current.page.items, ...page.items], nextPageToken: page.nextPageToken },
    };
    return { ...entry, [page.rel]: merged };
  });
}

// Visibilidades que conoce Mage (las asignables que dio el boot medido). Otra cosa se enseña tal cual.
const AUDIENCE_KEYS: Readonly<Record<string, MessageKey>> = {
  owner: 'chat.artifact.audience.owner',
  users: 'chat.artifact.audience.users',
  org: 'chat.artifact.audience.org',
  public: 'chat.artifact.audience.public',
};

// Texto de la visibilidad: la etiqueta traducida, el valor tal cual si es desconocido, o '' si no hay.
export function audienceLabel(translate: (key: MessageKey) => string, audience: string): string {
  const key = Object.hasOwn(AUDIENCE_KEYS, audience) ? AUDIENCE_KEYS[audience] : undefined;
  return key === undefined ? audience : translate(key);
}
