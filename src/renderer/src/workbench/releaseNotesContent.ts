import changelogText from '../../../../CHANGELOG.md?raw';
import changelogEnText from '../../../../CHANGELOG.en.md?raw';
import { parseChangelog, type ChangelogEntry } from './releaseNotes';

// Los changelogs, incrustados por Vite en el bundle (sin IPC ni fichero en el asar) y leidos UNA vez. Solo
// los importan modulos que ya van en diferido (la pestaña de novedades y Configuracion), asi que no pesan
// en el arranque.
const SPANISH_ENTRIES = parseChangelog(changelogText);
const ENGLISH_BY_VERSION = new Map(parseChangelog(changelogEnText).map((entry) => [entry.version, entry]));
// Respaldo (U4 de F3): la version sin traducir sale en castellano, con el orden de CHANGELOG.md.
const ENGLISH_ENTRIES: readonly ChangelogEntry[] = SPANISH_ENTRIES.map((entry) => ENGLISH_BY_VERSION.get(entry.version) ?? entry);

export function changelogEntriesFor(language: 'es' | 'en'): readonly ChangelogEntry[] {
  return language === 'en' ? ENGLISH_ENTRIES : SPANISH_ENTRIES;
}
