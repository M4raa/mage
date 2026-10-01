import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toAgyPermissionRules } from '@shared/agyRules';
import { agyAttachmentPath, agyProfileSettings, writeAgyProfileSettings } from './agyProfile';

describe('agyProfileSettings', () => {
  const base = { profileDir: '/perfil', cwd: '/proyecto', attachmentsDir: '/tmp/adjuntos' };
  const essentials = ['write_file(/proyecto)', 'read_file(/tmp/adjuntos)', `read_file(${join('/perfil', '.gemini', 'antigravity-cli', 'mcp')})`];

  it('agyProfileSettings_cuentaPorClave_modoClaveYLasReglasImprescindibles', () => {
    expect(agyProfileSettings({ ...base, mode: 'api-key' })).toEqual({ modelProvider: 'gemini', permissions: { allow: essentials, deny: [] } });
  });

  // Sin `modelProvider` agy usa su login de suscripcion (medido en un perfil aislado).
  it('agyProfileSettings_suscripcion_sinModelProvider', () => {
    expect(agyProfileSettings({ ...base, mode: 'subscription' })).toEqual({ permissions: { allow: essentials, deny: [] } });
  });

  it('agyProfileSettings_conReglasDelUsuario_seSumanDetrasDeLasImprescindibles', () => {
    const settings = agyProfileSettings({ ...base, mode: 'subscription', extra: { allow: ['command(git status)'], deny: ['command(rm -rf build)'] } });

    expect(settings.permissions).toEqual({ allow: [...essentials, 'command(git status)'], deny: ['command(rm -rf build)'] });
  });

  // Fase 3: las reglas MCP del dialogo llegan tal cual (`mcp(<srv>/<tool>)`), los comandos envueltos.
  it('agyProfileSettings_conReglasMcp_lasEscribeTalCual', () => {
    const extra = toAgyPermissionRules({ allow: ['git status', 'mcp(magespike/*)'], deny: ['mcp(magespike/mage_echo)'] });

    const settings = agyProfileSettings({ ...base, mode: 'subscription', extra });

    expect(settings.permissions).toEqual({ allow: [...essentials, 'command(git status)', 'mcp(magespike/*)'], deny: ['mcp(magespike/mage_echo)'] });
  });

  it.each(['', '  '])('agyProfileSettings_cwdVacio_lanza_%#', (cwd) => {
    expect(() => agyProfileSettings({ ...base, mode: 'api-key', cwd })).toThrow(/vacia/);
  });

  it('agyProfileSettings_perfilVacio_lanza', () => {
    expect(() => agyProfileSettings({ ...base, mode: 'subscription', profileDir: '' })).toThrow(/Perfil de agy vacio/);
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
