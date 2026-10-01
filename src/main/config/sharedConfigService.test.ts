import { describe, expect, it, vi } from 'vitest';
import {
  mcpCommonServerNames,
  parseMcpCommonJson,
  parseSettingsCommonJson,
  buildSettingsFragment,
  resolveSharedMcp,
  SharedConfigService,
  type SharedConfigDeps,
} from './sharedConfigService';

const MCP_PATH = '/userData/shared-config/mcp-common.json';
const SETTINGS_PATH = '/userData/shared-config/settings-common.json';

function deps(overrides: Partial<SharedConfigDeps> = {}): SharedConfigDeps {
  return {
    exists: () => true,
    readFile: () => '{}',
    writeFile: () => undefined,
    rename: () => undefined,
    ensureDir: () => undefined,
    tempSuffix: () => 'tmp1',
    log: () => undefined,
    ...overrides,
  };
}

describe('SharedConfigService.loadMcpCommon', () => {
  it('loadMcpCommon_ficheroAusente_devuelveNull', () => {
    const service = new SharedConfigService(deps({ exists: () => false }));

    expect(service.loadMcpCommon(MCP_PATH)).toBeNull();
  });

  it('loadMcpCommon_jsonInvalido_devuelveNullYLoguea', () => {
    const log = vi.fn();
    const service = new SharedConfigService(deps({ readFile: () => '{not json', log }));

    expect(service.loadMcpCommon(MCP_PATH)).toBeNull();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining(MCP_PATH));
  });

  it('loadMcpCommon_sinClaveMcpServers_devuelveNullYLoguea', () => {
    const log = vi.fn();
    const service = new SharedConfigService(deps({ readFile: () => '{"foo":1}', log }));

    expect(service.loadMcpCommon(MCP_PATH)).toBeNull();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('mcpServers'));
  });

  it('loadMcpCommon_mcpServersNoEsObjeto_devuelveNull', () => {
    const service = new SharedConfigService(deps({ readFile: () => '{"mcpServers":"nope"}' }));

    expect(service.loadMcpCommon(MCP_PATH)).toBeNull();
  });

  it('loadMcpCommon_valido_devuelvePathYServidores', () => {
    const raw = { mcpServers: { database: { command: 'database-mcp' } } };
    const service = new SharedConfigService(deps({ readFile: () => JSON.stringify(raw) }));

    expect(service.loadMcpCommon(MCP_PATH)).toEqual({ path: MCP_PATH, mcpServers: raw.mcpServers, onlyIn: {} });
  });
});

describe('SharedConfigService.loadSettingsCommon', () => {
  it('loadSettingsCommon_ficheroAusente_devuelveNull', () => {
    const service = new SharedConfigService(deps({ exists: () => false }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toBeNull();
  });

  it('loadSettingsCommon_jsonInvalido_devuelveNullYLoguea', () => {
    const log = vi.fn();
    const service = new SharedConfigService(deps({ readFile: () => 'nope', log }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toBeNull();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining(SETTINGS_PATH));
  });

  it('loadSettingsCommon_noEsObjeto_devuelveNullYLoguea', () => {
    const log = vi.fn();
    const service = new SharedConfigService(deps({ readFile: () => '[1,2,3]', log }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toBeNull();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('objeto'));
  });

  it('loadSettingsCommon_soloHooksValidos_seConservan', () => {
    const raw = { hooks: { Notification: [{ hookCallbackIds: ['x'] }] } };
    const service = new SharedConfigService(deps({ readFile: () => JSON.stringify(raw) }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toEqual({ hooks: raw.hooks });
  });

  it('loadSettingsCommon_permissionsAllowDeny_seConservan', () => {
    const raw = { permissions: { allow: ['Bash(git:*)'], deny: ['Bash(rm:*)'] } };
    const service = new SharedConfigService(deps({ readFile: () => JSON.stringify(raw) }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toEqual({ permissions: raw.permissions });
  });

  it('loadSettingsCommon_claveTopLevelDesconocida_seDescartaYLoguea', () => {
    const log = vi.fn();
    const raw = { model: 'opus', hooks: { Stop: [] } };
    const service = new SharedConfigService(deps({ readFile: () => JSON.stringify(raw), log }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toEqual({ hooks: { Stop: [] } });
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('"model"'));
  });

  it('loadSettingsCommon_permissionsDefaultMode_seDescartaEsaSubclaveYConservaAllowDeny', () => {
    const log = vi.fn();
    const raw = { permissions: { allow: ['a'], defaultMode: 'acceptEdits' } };
    const service = new SharedConfigService(deps({ readFile: () => JSON.stringify(raw), log }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toEqual({ permissions: { allow: ['a'] } });
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('permissions.defaultMode'));
  });

  it('loadSettingsCommon_hooksNoEsObjeto_seDescartaYLoguea', () => {
    const log = vi.fn();
    const raw = { hooks: 'nope', permissions: { allow: ['a'] } };
    const service = new SharedConfigService(deps({ readFile: () => JSON.stringify(raw), log }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toEqual({ permissions: { allow: ['a'] } });
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('"hooks"'));
  });

  it('loadSettingsCommon_permissionsAllowNoEsArrayDeStrings_seDescartaEsaSubclave', () => {
    const log = vi.fn();
    const raw = { permissions: { allow: 'no-array', deny: ['b'] } };
    const service = new SharedConfigService(deps({ readFile: () => JSON.stringify(raw), log }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toEqual({ permissions: { deny: ['b'] } });
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('permissions.allow'));
  });

  it('loadSettingsCommon_objetoVacio_devuelveObjetoVacio', () => {
    const service = new SharedConfigService(deps({ readFile: () => '{}' }));

    expect(service.loadSettingsCommon(SETTINGS_PATH)).toEqual({});
  });
});

describe('buildSettingsFragment', () => {
  it('buildSettingsFragment_nulo_devuelveNull', () => {
    expect(buildSettingsFragment(null)).toBeNull();
  });

  it('buildSettingsFragment_hooksNoVacios_losLleva', () => {
    expect(buildSettingsFragment({ hooks: { Stop: [{ hookCallbackIds: ['x'] }] } })).toEqual({ hooks: { Stop: [{ hookCallbackIds: ['x'] }] } });
  });

  it('buildSettingsFragment_hooksVacios_devuelveNull', () => {
    expect(buildSettingsFragment({ hooks: {} })).toBeNull();
  });

  it('buildSettingsFragment_permissionsConReglas_lasLleva', () => {
    expect(buildSettingsFragment({ permissions: { allow: ['a'], deny: ['b'] } })).toEqual({ permissions: { allow: ['a'], deny: ['b'] } });
  });

  it('buildSettingsFragment_permissionsArraysVacios_devuelveNull', () => {
    expect(buildSettingsFragment({ permissions: { allow: [], deny: [] } })).toBeNull();
  });
});

describe('resolveSharedMcp', () => {
  const extension = { servers: [{ name: 'ext', source: 'extension', onlyIn: null, extra: {}, secrets: {}, transport: 'stdio', command: 'x', args: [], env: {}, cwd: null } as const], warnings: [] };

  it('resolveSharedMcp_sinComunes_soloLasExtensiones', () => {
    expect(resolveSharedMcp(null, extension).servers.map((s) => s.name)).toEqual(['ext']);
  });

  it('resolveSharedMcp_comunesConSoloEn_llevanSuAlcance', () => {
    const common = { path: MCP_PATH, mcpServers: { database: { command: 'db' } }, onlyIn: { database: ['codex'] } };

    const result = resolveSharedMcp(common, { servers: [], warnings: [] });

    expect(result.servers).toMatchObject([{ name: 'database', source: 'common', onlyIn: ['codex'], command: 'db' }]);
  });

  it('resolveSharedMcp_comunMalDeclarado_seOmiteConAvisoYSigue', () => {
    const common = { path: MCP_PATH, mcpServers: { roto: { type: 'stdio' }, bien: { command: 'db' } }, onlyIn: {} };

    const result = resolveSharedMcp(common, { servers: [], warnings: [] });

    expect(result.servers.map((s) => s.name)).toEqual(['bien']);
    expect(result.warnings[0]).toContain('roto');
  });
});

describe('mcpCommonServerNames', () => {
  it('mcpCommonServerNames_nulo_devuelveArrayVacio', () => {
    expect(mcpCommonServerNames(null)).toEqual([]);
  });

  it('mcpCommonServerNames_conServidores_devuelveSusNombres', () => {
    const mcpCommon = { path: MCP_PATH, mcpServers: { database: {}, 'chrome-devtools': {} }, onlyIn: {} };

    expect(mcpCommonServerNames(mcpCommon)).toEqual(['database', 'chrome-devtools']);
  });
});

describe('parseMcpCommonJson (puro)', () => {
  it('parseMcpCommonJson_jsonInvalido_valueNuloConAviso', () => {
    const result = parseMcpCommonJson('{not json');

    expect(result.value).toBeNull();
    expect(result.warnings[0]).toContain('JSON invalido');
  });

  it('parseMcpCommonJson_valido_devuelveMcpServersSinWarnings', () => {
    const result = parseMcpCommonJson('{"mcpServers":{"database":{}}}');

    expect(result).toEqual({ value: { mcpServers: { database: {} }, onlyIn: {} }, warnings: [] });
  });

  it('parseMcpCommonJson_conSoloEn_loDevuelvePorServidorYDescartaLoQueNoEsLista', () => {
    const result = parseMcpCommonJson('{"mcpServers":{"a":{},"b":{}},"mageOnlyIn":{"a":["claude","codex|/h"],"b":"todo"}}');

    expect(result.value?.onlyIn).toEqual({ a: ['claude', 'codex|/h'], b: null });
  });
});

describe('parseSettingsCommonJson (puro)', () => {
  it('parseSettingsCommonJson_jsonInvalido_valueNuloConAviso', () => {
    const result = parseSettingsCommonJson('nope');

    expect(result.value).toBeNull();
    expect(result.warnings[0]).toContain('JSON invalido');
  });

  it('parseSettingsCommonJson_valido_devuelveValueSinWarnings', () => {
    const result = parseSettingsCommonJson('{"hooks":{"Stop":[]}}');

    expect(result).toEqual({ value: { hooks: { Stop: [] } }, warnings: [] });
  });
});

describe('SharedConfigService.readMcpCommonText / readSettingsCommonText', () => {
  it('readMcpCommonText_ficheroAusente_devuelveEsqueletoConMcpServersVacio', () => {
    const service = new SharedConfigService(deps({ exists: () => false }));

    expect(service.readMcpCommonText(MCP_PATH)).toBe('{"mcpServers": {}}');
  });

  it('readMcpCommonText_ficheroPresente_devuelveSuContenidoTalCual', () => {
    const service = new SharedConfigService(deps({ readFile: () => '{"mcpServers":{"a":{}}}' }));

    expect(service.readMcpCommonText(MCP_PATH)).toBe('{"mcpServers":{"a":{}}}');
  });

  it('readMcpCommonText_errorDeLectura_devuelveEsqueletoYLoguea', () => {
    const log = vi.fn();
    const service = new SharedConfigService(
      deps({
        readFile: () => {
          throw new Error('EACCES');
        },
        log,
      }),
    );

    expect(service.readMcpCommonText(MCP_PATH)).toBe('{"mcpServers": {}}');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining(MCP_PATH));
  });

  it('readSettingsCommonText_ficheroAusente_devuelveJsonVacio', () => {
    const service = new SharedConfigService(deps({ exists: () => false }));

    expect(service.readSettingsCommonText(SETTINGS_PATH)).toBe('{}');
  });
});

describe('SharedConfigService.saveMcpCommonText', () => {
  it('saveMcpCommonText_jsonInvalido_lanzaSinEscribir', () => {
    const writeFile = vi.fn();
    const service = new SharedConfigService(deps({ writeFile }));

    expect(() => service.saveMcpCommonText(MCP_PATH, '{not json', '{}')).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('saveMcpCommonText_sinFormaEsperada_lanzaSinEscribir', () => {
    const writeFile = vi.fn();
    const service = new SharedConfigService(deps({ writeFile }));

    expect(() => service.saveMcpCommonText(MCP_PATH, '{"foo":1}', '{}')).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('saveMcpCommonText_valido_escribeAtomicoYDevuelveSinWarnings', () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    const ensureDir = vi.fn();
    const service = new SharedConfigService(deps({ writeFile, rename, ensureDir, tempSuffix: () => 'xyz' }));
    const text = '{"mcpServers":{"a":{}}}';

    const outcome = service.saveMcpCommonText(MCP_PATH, text, '{}');

    expect(outcome).toEqual({ status: 'saved', warnings: [] });
    expect(ensureDir).toHaveBeenCalledWith('/userData/shared-config');
    expect(writeFile).toHaveBeenCalledWith(`${MCP_PATH}.xyz.tmp`, text);
    expect(rename).toHaveBeenCalledWith(`${MCP_PATH}.xyz.tmp`, MCP_PATH);
  });
});

// Estos dos ficheros los edita tambien el usuario a mano y puede tocarlos otra instancia de Mage, asi
// que "el ultimo que escribe gana" significa perder trabajo ajeno en silencio.
describe('SharedConfigService compare-and-swap al guardar', () => {
  it('save_ficheroCambiadoFueraDeMage_rechazaSinEscribirYExplicaPorQue', () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    const log = vi.fn();
    // En disco hay otra cosa distinta de lo que el editor leyo.
    const service = new SharedConfigService(deps({ readFile: () => '{"mcpServers":{"otro":{}}}', writeFile, rename, log }));

    const outcome = service.saveMcpCommonText(MCP_PATH, '{"mcpServers":{"mio":{}}}', '{"mcpServers":{}}');

    expect(outcome.status).toBe('stale');
    if (outcome.status !== 'stale') throw new Error('se esperaba stale');
    expect(outcome.message).toContain(MCP_PATH);
    expect(outcome.message).toContain('cambio fuera de Mage');
    expect(rename).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining(MCP_PATH));
  });

  it('save_creacionCuandoElFicheroNoExistia_publica', () => {
    const rename = vi.fn();
    const service = new SharedConfigService(deps({ exists: () => false, rename }));

    const outcome = service.saveMcpCommonText(MCP_PATH, '{"mcpServers":{}}', null);

    expect(outcome.status).toBe('saved');
    expect(rename).toHaveBeenCalled();
  });

  it('save_creacionPeroOtroLoCreoAntes_rechaza', () => {
    const rename = vi.fn();
    const service = new SharedConfigService(deps({ exists: () => true, readFile: () => '{"mcpServers":{}}', rename }));

    const outcome = service.saveMcpCommonText(MCP_PATH, '{"mcpServers":{"a":{}}}', null);

    expect(outcome.status).toBe('stale');
    expect(rename).not.toHaveBeenCalled();
  });

  // Fail-closed: si ni siquiera se puede saber contra que comparamos, no se escribe.
  it('save_ficheroIlegible_rechazaEnVezDePisar', () => {
    const rename = vi.fn();
    const log = vi.fn();
    const service = new SharedConfigService(
      deps({
        exists: () => true,
        readFile: () => {
          throw new Error('EACCES: permission denied');
        },
        rename,
        log,
      }),
    );

    const outcome = service.saveMcpCommonText(MCP_PATH, '{"mcpServers":{}}', '{}');

    expect(outcome.status).toBe('stale');
    if (outcome.status !== 'stale') throw new Error('se esperaba stale');
    expect(outcome.message).toContain('EACCES');
    expect(rename).not.toHaveBeenCalled();
  });
});

describe('SharedConfigService.readBaseline', () => {
  // No se puede reutilizar read*Text como base del CAS: ese devuelve un JSON de arranque cuando el
  // fichero no existe, y el CAS creeria que el fichero contenia ese texto.
  it('readBaseline_ficheroAusente_devuelveNullNoElTextoDeArranque', () => {
    const service = new SharedConfigService(deps({ exists: () => false }));

    expect(service.readBaseline(MCP_PATH)).toBeNull();
    expect(service.readMcpCommonText(MCP_PATH)).toBe('{"mcpServers": {}}');
  });

  it('readBaseline_ficheroPresente_devuelveLosBytesTalCual', () => {
    const service = new SharedConfigService(deps({ readFile: () => '  {"mcpServers":{}}  ' }));

    expect(service.readBaseline(MCP_PATH)).toBe('  {"mcpServers":{}}  ');
  });

  it('readBaseline_ilegible_devuelveNullYAvisa', () => {
    const log = vi.fn();
    const service = new SharedConfigService(
      deps({
        readFile: () => {
          throw new Error('EACCES');
        },
        log,
      }),
    );

    expect(service.readBaseline(MCP_PATH)).toBeNull();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining(MCP_PATH));
  });
});

describe('SharedConfigService.saveSettingsCommonText', () => {
  it('saveSettingsCommonText_jsonInvalido_lanzaSinEscribir', () => {
    const writeFile = vi.fn();
    const service = new SharedConfigService(deps({ writeFile }));

    expect(() => service.saveSettingsCommonText(SETTINGS_PATH, 'nope', '{}')).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('saveSettingsCommonText_conClaveDescartada_escribeYDevuelveElAviso', () => {
    const writeFile = vi.fn();
    const service = new SharedConfigService(deps({ writeFile }));
    const text = '{"model":"opus","hooks":{"Stop":[]}}';

    const outcome = service.saveSettingsCommonText(SETTINGS_PATH, text, '{}');

    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') throw new Error('se esperaba saved');
    expect(outcome.warnings[0]).toContain('"model"');
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('.tmp'), text);
  });
});
