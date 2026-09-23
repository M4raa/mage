import { describe, expect, it } from 'vitest';
import {
  accountsByUsage,
  buildJumpListCategories,
  parseJumpListArgs,
  type JumpListSource,
} from './jumpList';

const PROGRAM = 'C:\\Mage\\mage.exe';

function source(overrides: Partial<JumpListSource> = {}): JumpListSource {
  return {
    accounts: [
      { configDir: 'C:\\Users\\u\\.claude', alias: 'principal' },
      { configDir: 'C:\\Users\\u\\.claude-b', alias: 'trabajo' },
    ],
    conversations: [
      { sessionId: 's1', title: 'Arreglar el login', accountDir: 'C:\\Users\\u\\.claude', updatedAtMs: 100 },
      { sessionId: 's2', title: 'Migrar la base', accountDir: 'C:\\Users\\u\\.claude-b', updatedAtMs: 300 },
    ],
    tabAccountIds: [],
    ...overrides,
  };
}

describe('parseJumpListArgs', () => {
  it('parseJumpListArgs_argvNormal_devuelveNull', () => {
    expect(parseJumpListArgs(['electron.exe', '.'])).toBeNull();
  });

  it('parseJumpListArgs_soloCuenta_esNuevaConversacionEnEsaCuenta', () => {
    const result = parseJumpListArgs(['mage.exe', '--mage-account=C:\\Users\\u\\.claude']);

    expect(result).toEqual({ accountDir: 'C:\\Users\\u\\.claude' });
  });

  it('parseJumpListArgs_cuentaYSesion_devuelveLasDos', () => {
    const result = parseJumpListArgs(['mage.exe', '--mage-account=C:\\a', '--mage-session=s9']);

    expect(result).toEqual({ accountDir: 'C:\\a', sessionId: 's9' });
  });

  it('parseJumpListArgs_sesionSinCuenta_devuelveNull', () => {
    // Sin cuenta no hay donde buscar la conversacion: mejor ignorar que abrir cualquier cosa.
    expect(parseJumpListArgs(['mage.exe', '--mage-session=s9'])).toBeNull();
  });

  it('parseJumpListArgs_banderaVacia_devuelveNull', () => {
    expect(parseJumpListArgs(['mage.exe', '--mage-account='])).toBeNull();
  });

  it('parseJumpListArgs_rutaConEspacios_laConservaEntera', () => {
    // El SO ya quita las comillas: llega como UN argumento con espacios dentro.
    const result = parseJumpListArgs(['mage.exe', '--mage-account=C:\\Users\\Juan Perez\\.claude']);

    expect(result).toEqual({ accountDir: 'C:\\Users\\Juan Perez\\.claude' });
  });
});

describe('accountsByUsage', () => {
  it('accountsByUsage_conPestañas_ordenaPorNumeroDeUsos', () => {
    const accounts = source().accounts;
    const tabAccountIds = ['C:\\Users\\u\\.claude-b', 'C:\\Users\\u\\.claude-b', 'C:\\Users\\u\\.claude'];

    expect(accountsByUsage(accounts, tabAccountIds).map((a) => a.alias)).toEqual(['trabajo', 'principal']);
  });

  it('accountsByUsage_sinPestañas_conservaElOrdenDeDescubrimiento', () => {
    expect(accountsByUsage(source().accounts, []).map((a) => a.alias)).toEqual(['principal', 'trabajo']);
  });

  it('accountsByUsage_empate_conservaElOrdenDeDescubrimiento', () => {
    const tabAccountIds = ['C:\\Users\\u\\.claude', 'C:\\Users\\u\\.claude-b'];

    expect(accountsByUsage(source().accounts, tabAccountIds).map((a) => a.alias)).toEqual(['principal', 'trabajo']);
  });

  it('accountsByUsage_pestañaDeUnaCuentaQueYaNoExiste_noRompe', () => {
    expect(accountsByUsage(source().accounts, ['C:\\borrada']).map((a) => a.alias)).toEqual(['principal', 'trabajo']);
  });
});

describe('buildJumpListCategories', () => {
  it('buildJumpListCategories_conDatos_devuelveRecientesYCuentas', () => {
    const categories = buildJumpListCategories(source(), PROGRAM);

    expect(categories.map((c) => c.name)).toEqual(['Recientes', 'Cuentas']);
  });

  it('buildJumpListCategories_recientes_vanDeMasNuevaAMasVieja', () => {
    const categories = buildJumpListCategories(source(), PROGRAM);

    expect(categories[0]?.items.map((i) => i.title)).toEqual(['Migrar la base', 'Arreglar el login']);
  });

  it('buildJumpListCategories_unaConversacion_llevaSuCuentaYSuSesionEnLosArgumentos', () => {
    const item = buildJumpListCategories(source(), PROGRAM)[0]?.items[0];

    expect(item?.program).toBe(PROGRAM);
    expect(item?.args).toBe('--mage-account="C:\\Users\\u\\.claude-b" --mage-session="s2"');
  });

  it('buildJumpListCategories_itemDeCuenta_soloLlevaLaCuenta', () => {
    const item = buildJumpListCategories(source({ conversations: [] }), PROGRAM)[0]?.items[0];

    expect(item?.args).toBe('--mage-account="C:\\Users\\u\\.claude"');
  });

  it('buildJumpListCategories_sinConversaciones_omiteEsaCategoria', () => {
    const categories = buildJumpListCategories(source({ conversations: [] }), PROGRAM);

    expect(categories.map((c) => c.name)).toEqual(['Cuentas']);
  });

  it('buildJumpListCategories_sinNadaQueOfrecer_devuelveVacio', () => {
    expect(buildJumpListCategories({ accounts: [], conversations: [], tabAccountIds: [] }, PROGRAM)).toEqual([]);
  });

  it('buildJumpListCategories_masDeOchoConversaciones_seQuedaConLasOchoMasRecientes', () => {
    const conversations = Array.from({ length: 12 }, (_, i) => ({
      sessionId: `s${i}`,
      title: `c${i}`,
      accountDir: 'C:\\a',
      updatedAtMs: i,
    }));

    const items = buildJumpListCategories(source({ conversations }), PROGRAM)[0]?.items ?? [];

    expect(items).toHaveLength(8);
    expect(items[0]?.title).toBe('c11');
  });

  it('buildJumpListCategories_tituloLarguisimo_seRecorta', () => {
    const conversations = [{ sessionId: 's', title: 'x'.repeat(200), accountDir: 'C:\\a', updatedAtMs: 1 }];

    const title = buildJumpListCategories(source({ conversations }), PROGRAM)[0]?.items[0]?.title ?? '';

    expect(title).toHaveLength(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('buildJumpListCategories_tituloVacio_usaUnTextoDeRespaldo', () => {
    const conversations = [{ sessionId: 's', title: '   ', accountDir: 'C:\\a', updatedAtMs: 1 }];

    expect(buildJumpListCategories(source({ conversations }), PROGRAM)[0]?.items[0]?.title).toBe('Sin título');
  });

  it('buildJumpListCategories_valorConComillas_noRompeElArgumento', () => {
    // Una comilla suelta partiria el argumento en dos al releerlo desde argv.
    const conversations = [{ sessionId: 's"1', title: 't', accountDir: 'C:\\a', updatedAtMs: 1 }];

    const args = buildJumpListCategories(source({ conversations }), PROGRAM)[0]?.items[0]?.args ?? '';

    expect(args).toBe('--mage-account="C:\\a" --mage-session="s1"');
  });
});
