import { describe, expect, it } from 'vitest';
import { toServerDraft } from '@shared/mcp';
import { applyMcpCommonMutation, revealMcpCommonSecrets } from './mcpCommonEdit';

const LOCAL = { type: 'stdio', command: 'npx', args: ['-y', 'a'], env: { A_TOKEN: 'secreto-a' } };
const REMOTE = { type: 'http', url: 'https://r.dev/mcp', headers: { Authorization: 'Bearer secreto-r' } };
const text = (root: Record<string, unknown>): string => JSON.stringify(root);
const parse = (raw: string): Record<string, unknown> => JSON.parse(raw) as Record<string, unknown>;

describe('applyMcpCommonMutation', () => {
  it('applyMcpCommonMutation_upsertNuevoRemoto_seGuardaSinCommand', () => {
    const draft = { ...toServerDraft('r', null), transport: 'http' as const, url: 'https://r.dev/mcp' };

    const result = parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL } }), { op: 'upsert', originalName: null, draft }));

    expect(result.mcpServers).toEqual({ a: LOCAL, r: { type: 'http', url: 'https://r.dev/mcp' } });
  });

  it('applyMcpCommonMutation_upsertConValoresOcultos_losConserva', () => {
    const draft = toServerDraft('r', REMOTE);

    const result = parse(applyMcpCommonMutation(text({ mcpServers: { r: REMOTE } }), { op: 'upsert', originalName: 'r', draft }));

    expect(result.mcpServers).toEqual({ r: REMOTE });
  });

  it('applyMcpCommonMutation_renombrar_quitaElViejoYConservaOtrasClaves', () => {
    const draft = { ...toServerDraft('a', LOCAL), name: 'b' };

    const result = parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL }, otra: 1 }), { op: 'upsert', originalName: 'a', draft }));

    expect(result).toEqual({ mcpServers: { b: LOCAL }, otra: 1 });
  });

  it('applyMcpCommonMutation_renombrarAUnNombreExistente_lanza', () => {
    const draft = { ...toServerDraft('a', LOCAL), name: 'r' };

    expect(() => applyMcpCommonMutation(text({ mcpServers: { a: LOCAL, r: REMOTE } }), { op: 'upsert', originalName: 'a', draft })).toThrow('"r"');
  });

  it('applyMcpCommonMutation_desactivar_loSacaDeMcpServersSinBorrarlo', () => {
    const result = parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL } }), { op: 'setDisabled', name: 'a', disabled: true }));

    expect(result).toEqual({ mcpServers: {}, mageDisabledServers: { a: LOCAL } });
  });

  it('applyMcpCommonMutation_reactivar_loDevuelveYQuitaLaClaveVacia', () => {
    const result = parse(applyMcpCommonMutation(text({ mcpServers: {}, mageDisabledServers: { a: LOCAL } }), { op: 'setDisabled', name: 'a', disabled: false }));

    expect(result).toEqual({ mcpServers: { a: LOCAL } });
  });

  it('applyMcpCommonMutation_editarUnDesactivado_sigueDesactivado', () => {
    const draft = { ...toServerDraft('a', LOCAL), command: 'node' };

    const result = parse(applyMcpCommonMutation(text({ mcpServers: {}, mageDisabledServers: { a: LOCAL } }), { op: 'upsert', originalName: 'a', draft }));

    expect(result.mageDisabledServers).toEqual({ a: { ...LOCAL, command: 'node' } });
  });

  it('applyMcpCommonMutation_quitar_loBorra', () => {
    expect(parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL } }), { op: 'remove', name: 'a' })).mcpServers).toEqual({});
  });

  it('applyMcpCommonMutation_nombreQueNoExiste_lanza', () => {
    expect(() => applyMcpCommonMutation(text({ mcpServers: {} }), { op: 'remove', name: 'x' })).toThrow('"x"');
  });

  it('applyMcpCommonMutation_textoInvalido_lanzaSinElTexto', () => {
    expect(() => applyMcpCommonMutation('{"secreto-a"', { op: 'remove', name: 'x' })).toThrow(/caracteres$/);
    try {
      applyMcpCommonMutation('{"secreto-a"', { op: 'remove', name: 'x' });
    } catch (error) {
      expect(String(error)).not.toContain('secreto');
    }
  });
});

describe('applyMcpCommonMutation · «Solo en…»', () => {
  it('setOnlyIn_lista_seGuardaEnMageOnlyIn', () => {
    const result = parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL } }), { op: 'setOnlyIn', name: 'a', onlyIn: ['claude', 'codex|/h'] }));

    expect(result.mageOnlyIn).toEqual({ a: ['claude', 'codex|/h'] });
    expect(result.mcpServers).toEqual({ a: LOCAL });
  });

  it('setOnlyIn_null_quitaLaEntradaYLaClaveSiQuedaVacia', () => {
    const result = parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL }, mageOnlyIn: { a: ['agy'] } }), { op: 'setOnlyIn', name: 'a', onlyIn: null }));

    expect(result.mageOnlyIn).toBeUndefined();
  });

  it('setOnlyIn_listaVacia_lanza', () => {
    expect(() => applyMcpCommonMutation(text({ mcpServers: { a: LOCAL } }), { op: 'setOnlyIn', name: 'a', onlyIn: [] })).toThrow(/vacío/);
  });

  it('setOnlyIn_noEsComun_lanza', () => {
    expect(() => applyMcpCommonMutation(text({ mcpServers: {} }), { op: 'setOnlyIn', name: 'a', onlyIn: ['claude'] })).toThrow(/ya no está/);
  });

  it('renombrar_seLlevaSuSoloEn', () => {
    const draft = { ...toServerDraft('a', LOCAL), name: 'b' };

    const result = parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL }, mageOnlyIn: { a: ['codex'] } }), { op: 'upsert', originalName: 'a', draft }));

    expect(result.mageOnlyIn).toEqual({ b: ['codex'] });
  });

  it('quitar_borraSuSoloEn', () => {
    const result = parse(applyMcpCommonMutation(text({ mcpServers: { a: LOCAL }, mageOnlyIn: { a: ['codex'] } }), { op: 'remove', name: 'a' }));

    expect(result.mageOnlyIn).toBeUndefined();
  });
});

describe('revealMcpCommonSecrets', () => {
  it('revealMcpCommonSecrets_comun_devuelveEnvYHeaders', () => {
    expect(revealMcpCommonSecrets(text({ mcpServers: { r: REMOTE } }), 'r')).toEqual({ env: {}, headers: REMOTE.headers });
  });

  it('revealMcpCommonSecrets_desactivado_tambien', () => {
    expect(revealMcpCommonSecrets(text({ mageDisabledServers: { a: LOCAL } }), 'a').env).toEqual(LOCAL.env);
  });

  it('revealMcpCommonSecrets_noEsComun_lanza', () => {
    expect(() => revealMcpCommonSecrets(text({ mcpServers: {} }), 'a')).toThrow('no es un servidor común');
  });
});
