import { describe, expect, it } from 'vitest';
import changelogText from '../../../../CHANGELOG.md?raw';
import changelogEnText from '../../../../CHANGELOG.en.md?raw';
import { compareVersions, parseChangelog } from './releaseNotes';
import { changelogEntriesFor } from './releaseNotesContent';

// Primera version con notas en ingles: las anteriores salen en castellano (U4 de F3).
const FIRST_TRANSLATED = '0.1.3';

describe('changelogEntriesFor', () => {
  it('changelogEntriesFor_es_lasDelCastellano', () => {
    const expected = parseChangelog(changelogText);

    const entries = changelogEntriesFor('es');

    expect(entries).toEqual(expected);
  });

  it('changelogEntriesFor_en_usaLaInglesaSiExiste', () => {
    const english = parseChangelog(changelogEnText);

    const entries = changelogEntriesFor('en');

    for (const translated of english) expect(entries.find((e) => e.version === translated.version)).toEqual(translated);
    expect(entries.find((e) => e.version === '0.1.4')!.body).toContain('### Added');
  });

  it('changelogEntriesFor_en_respaldoCastellanoParaVersionesSinTraducir', () => {
    const spanish = changelogEntriesFor('es');

    const entries = changelogEntriesFor('en');

    expect(entries.map((e) => e.version)).toEqual(spanish.map((e) => e.version));
    expect(entries.find((e) => e.version === '0.1.2')).toEqual(spanish.find((e) => e.version === '0.1.2'));
    expect(entries.find((e) => e.version === '0.1.2')!.body).toContain('### Corregido');
  });
});

describe('changelogs', () => {
  it('changelogs_mismasVersionesTraducidas_desde013', () => {
    const english = new Map(parseChangelog(changelogEnText).map((e) => [e.version, e]));
    const required = parseChangelog(changelogText).filter((e) => compareVersions(e.version, FIRST_TRANSLATED) >= 0);

    expect(required.length).toBeGreaterThanOrEqual(2);
    for (const entry of required) expect(english.get(entry.version)?.label).toBe(entry.label);
  });

  it('changelogs_mismasVinetasEnCadaSeccion_desde013', () => {
    const bullets = (body: string): number => body.split('\n').filter((l) => l.startsWith('- ')).length;
    const english = new Map(parseChangelog(changelogEnText).map((e) => [e.version, e]));
    const required = parseChangelog(changelogText).filter((e) => compareVersions(e.version, FIRST_TRANSLATED) >= 0);

    for (const entry of required) expect(bullets(english.get(entry.version)!.body)).toBe(bullets(entry.body));
  });
});
