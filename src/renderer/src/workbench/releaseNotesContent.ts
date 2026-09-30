import changelogText from '../../../../CHANGELOG.md?raw';
import { parseChangelog } from './releaseNotes';

// El changelog, incrustado por Vite en el bundle (sin IPC ni fichero en el asar) y leido UNA vez. Solo lo
// importan modulos que ya van en diferido (la pestaña de novedades y Configuracion), asi que no pesa en
// el arranque.
export const CHANGELOG_ENTRIES = parseChangelog(changelogText);
