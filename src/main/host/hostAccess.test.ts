import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessFor, findClientByToken, hashClientToken, isMethodAllowed, readOnlyMethods } from './hostAccess';
import { HOST_METHOD_SCHEMAS, type HostMethod } from './hostProtocol';

const ALL_METHODS = Object.keys(HOST_METHOD_SCHEMAS) as HostMethod[];
const WRITES: readonly HostMethod[] = ['session.send', 'session.create', 'session.setOption', 'session.answerPermission', 'session.answerElicitation', 'session.interrupt', 'session.rewind', 'session.cancelQueued', 'session.updateQueued', 'host.stop', 'accounts.create'];

describe('isMethodAllowed', () => {
  it('isMethodAllowed_lectura_soloLosQueNoCambianNada', () => {
    const allowed = ALL_METHODS.filter((method) => isMethodAllowed('read', method));

    expect(allowed).toEqual(readOnlyMethods());
    expect(allowed).toEqual(expect.arrayContaining(['sessions.list', 'session.snapshot', 'session.subscribe', 'host.info', 'projects.list', 'accounts.list']));
  });

  it('isMethodAllowed_lectura_ningunaEscrituraNiTunel', () => {
    for (const method of [...WRITES, 'mcp.message' as const]) expect(isMethodAllowed('read', method)).toBe(false);
  });

  it('isMethodAllowed_tunel_lecturaYMcpPeroNingunaEscritura', () => {
    expect(isMethodAllowed('tunnel', 'mcp.message')).toBe(true);
    expect(isMethodAllowed('tunnel', 'sessions.list')).toBe(true);
    for (const method of WRITES) expect(isMethodAllowed('tunnel', method)).toBe(false);
  });

  it('isMethodAllowed_emparejado_todos', () => {
    for (const method of ALL_METHODS) expect(isMethodAllowed('full', method)).toBe(true);
  });
});

describe('accessFor', () => {
  it('accessFor_emparejado_completoAunqueSeaMcp', () => {
    expect(accessFor({ clientKind: 'mcp', pairedClientId: 'c1', liveMageCaller: false })).toBe('full');
    expect(accessFor({ clientKind: 'terminal', pairedClientId: 'c1', liveMageCaller: false })).toBe('full');
  });

  it('accessFor_mcpConLlamanteVivo_tunel', () => {
    expect(accessFor({ clientKind: 'mcp', pairedClientId: null, liveMageCaller: true })).toBe('tunnel');
  });

  it('accessFor_terminalConLlamanteVivo_lectura', () => {
    expect(accessFor({ clientKind: 'terminal', pairedClientId: null, liveMageCaller: true })).toBe('read');
    expect(accessFor({ clientKind: 'widget', pairedClientId: null, liveMageCaller: true })).toBe('read');
  });

  it('accessFor_sinNada_lectura', () => {
    expect(accessFor({ clientKind: 'mcp', pairedClientId: null, liveMageCaller: false })).toBe('read');
  });
});

describe('hashClientToken', () => {
  it('hashClientToken_token_sha256Hex', () => {
    const token = 'ab'.repeat(32);

    expect(hashClientToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashClientToken(token)).not.toContain(token);
  });

  it('hashClientToken_vacio_lanza', () => {
    expect(() => hashClientToken('')).toThrow(/vacío/);
  });
});

describe('findClientByToken', () => {
  const tokenA = 'a'.repeat(64);
  const tokenB = 'b'.repeat(64);
  const clients = [{ id: 'A', tokenHash: hashClientToken(tokenA) }, { id: 'B', tokenHash: hashClientToken(tokenB) }];

  it('findClientByToken_tokenEmparejado_suCliente', () => {
    expect(findClientByToken(clients, tokenB)?.id).toBe('B');
  });

  it('findClientByToken_tokenDesconocido_null', () => {
    expect(findClientByToken(clients, 'c'.repeat(64))).toBeNull();
  });

  it('findClientByToken_sinClientes_null', () => {
    expect(findClientByToken([], tokenA)).toBeNull();
  });

  it('findClientByToken_formaInvalida_nullSinHashear', () => {
    expect(findClientByToken(clients, '')).toBeNull();
    expect(findClientByToken(clients, tokenA.toUpperCase())).toBeNull();
    expect(findClientByToken(clients, `${tokenA}0`)).toBeNull();
  });

  it('findClientByToken_hashGuardadoCorrupto_noCoincide', () => {
    expect(findClientByToken([{ id: 'X', tokenHash: 'zz' }], tokenA)).toBeNull();
  });

  it('findClientByToken_elHashNoEsElToken_noValePresentarElHash', () => {
    expect(findClientByToken(clients, hashClientToken(tokenA))).toBeNull();
  });
});
