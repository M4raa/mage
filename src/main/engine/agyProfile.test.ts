import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agyApiProfileSettings, agyAttachmentPath, writeAgyProfileSettings } from './agyProfile';

describe('agyApiProfileSettings', () => {
  it('agyApiProfileSettings_siempre_modoClaveEscrituraEnElCwdYLecturaDeAdjuntos', () => {
    expect(agyApiProfileSettings('C:\\proyecto', 'C:\\tmp\\adjuntos')).toEqual({
      modelProvider: 'gemini',
      permissions: { allow: ['write_file(C:\\proyecto)', 'read_file(C:\\tmp\\adjuntos)'], deny: [] },
    });
  });

  // Costura de M10/M15: las reglas que conceda el usuario se suman sin tocar las imprescindibles.
  it('agyApiProfileSettings_conReglasExtra_seSuman', () => {
    const settings = agyApiProfileSettings('C:\\p', 'C:\\a', { allow: ['command(git status)'], deny: ['command(regex:^rm .*)'] });

    expect(settings.permissions).toEqual({ allow: ['write_file(C:\\p)', 'read_file(C:\\a)', 'command(git status)'], deny: ['command(regex:^rm .*)'] });
  });

  it.each(['', '  '])('agyApiProfileSettings_cwdVacio_lanza_%#', (cwd) => {
    expect(() => agyApiProfileSettings(cwd, 'C:\\a')).toThrow(/vacia/);
  });
});

describe('writeAgyProfileSettings', () => {
  it('writeAgyProfileSettings_siempre_escribeElSettingsDelCliDentroDelPerfil', () => {
    const written = new Map<string, string>();

    const path = writeAgyProfileSettings({ mkdir: () => undefined, writeFile: (p, text) => written.set(p, text) }, join('/perfil'), { modelProvider: 'gemini' });

    expect(path).toBe(join('/perfil', '.gemini', 'antigravity-cli', 'settings.json'));
    expect(JSON.parse(written.get(path) ?? '')).toEqual({ modelProvider: 'gemini' });
  });
});

describe('agyAttachmentPath', () => {
  it('agyAttachmentPath_idConCaracteresRaros_seLimpianYLlevaSuExtension', () => {
    const path = agyAttachmentPath(join('/tmp', 'adj'), '../s1', { mediaType: 'image/jpeg', data: '' }, 1);

    expect(path.startsWith(join('/tmp', 'adj', '___s1'))).toBe(true);
    expect(path.endsWith('-2.jpg')).toBe(true);
  });
});
