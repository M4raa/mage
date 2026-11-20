import { describe, expect, it, vi } from 'vitest';
import { hashClientToken } from './hostAccess';
import { HostClientStore, parseClients } from './hostClients';

const NOW = '2026-11-20T10:00:00.000Z';
const LATER = '2026-11-20T11:00:00.000Z';

function harness(initial: string | null = null) {
  let file = initial;
  let clock = NOW;
  let ids = 0;
  let seed = 1;
  const log = vi.fn();
  const writes: string[] = [];
  const store = new HostClientStore({
    readFile: () => file,
    writeFile: (content) => { file = content; writes.push(content); },
    randomBytes: (size) => Buffer.alloc(size, seed++),
    newId: () => `id-${++ids}`,
    now: () => clock,
    log,
  });
  return { store, log, writes, file: () => file, setClock: (value: string) => { clock = value; } };
}

describe('HostClientStore', () => {
  it('add_cliente_devuelveTokenYEnDiscoSoloSuHash', () => {
    const h = harness();

    const paired = h.store.add({ name: 'mage', kind: 'terminal' });

    expect(paired.clientToken).toMatch(/^[0-9a-f]{64}$/);
    expect(h.file()).not.toContain(paired.clientToken);
    expect(h.file()).toContain(hashClientToken(paired.clientToken));
    expect(h.store.list()).toEqual([{ id: paired.clientId, name: 'mage', kind: 'terminal', createdAt: NOW, lastUsedAt: null }]);
  });

  it('authenticate_tokenEmparejado_idYAnotaUltimoUso', () => {
    const h = harness();
    const paired = h.store.add({ name: 'mage', kind: 'terminal' });
    h.setClock(LATER);

    const id = h.store.authenticate(paired.clientToken);

    expect(id).toBe(paired.clientId);
    expect(h.store.list()[0]!.lastUsedAt).toBe(LATER);
    expect(JSON.parse(h.file()!).clients[0].lastUsedAt).toBe(LATER);
  });

  it('authenticate_tokenDesconocido_nullSinEscribir', () => {
    const h = harness();
    h.store.add({ name: 'mage', kind: 'terminal' });
    const before = h.writes.length;

    expect(h.store.authenticate('f'.repeat(64))).toBeNull();
    expect(h.writes).toHaveLength(before);
  });

  it('dosClientes_tokensDistintos_cadaUnoElSuyo', () => {
    const h = harness();
    const a = h.store.add({ name: 'a', kind: 'terminal' });
    const b = h.store.add({ name: 'b', kind: 'widget' });

    expect(a.clientToken).not.toBe(b.clientToken);
    expect(h.store.authenticate(b.clientToken)).toBe(b.clientId);
  });

  it('revoke_cliente_loQuitaYAvisaASusConexiones', () => {
    const h = harness();
    const paired = h.store.add({ name: 'mage', kind: 'terminal' });
    const listener = vi.fn();
    h.store.onRevoked(paired.clientId, listener);

    const removed = h.store.revoke(paired.clientId);

    expect(removed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.store.list()).toEqual([]);
    expect(h.store.authenticate(paired.clientToken)).toBeNull();
  });

  it('revoke_idInexistente_falseSinAvisar', () => {
    const h = harness();
    const paired = h.store.add({ name: 'mage', kind: 'terminal' });
    const listener = vi.fn();
    h.store.onRevoked(paired.clientId, listener);

    expect(h.store.revoke('otro')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('onRevoked_desuscrito_noAvisa', () => {
    const h = harness();
    const paired = h.store.add({ name: 'mage', kind: 'terminal' });
    const listener = vi.fn();
    const stop = h.store.onRevoked(paired.clientId, listener);

    stop();
    h.store.revoke(paired.clientId);

    expect(listener).not.toHaveBeenCalled();
  });

  it('reinicio_ficheroEscrito_seLeeIgual', () => {
    const first = harness();
    const paired = first.store.add({ name: 'mage', kind: 'terminal' });

    const second = harness(first.file());

    expect(second.store.authenticate(paired.clientToken)).toBe(paired.clientId);
  });
});

describe('parseClients', () => {
  const valid = { id: 'a', name: 'mage', kind: 'terminal', tokenHash: 'a'.repeat(64), createdAt: NOW, lastUsedAt: null };

  it('parseClients_sinFichero_vacioSinAvisar', () => {
    const log = vi.fn();

    expect(parseClients(null, log)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('parseClients_jsonIlegible_vacioYAvisa', () => {
    const log = vi.fn();

    expect(parseClients('{no', log)).toEqual([]);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('ilegible'), expect.anything());
  });

  it('parseClients_versionDesconocida_vacioYAvisa', () => {
    const log = vi.fn();

    expect(parseClients(JSON.stringify({ version: 2, clients: [valid] }), log)).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('parseClients_entradaInvalida_seDescartaYLasDemasQuedan', () => {
    const log = vi.fn();
    const bad = [{ ...valid, id: 'b', tokenHash: 'corto' }, { ...valid, id: 'c', createdAt: 'ayer' }, { ...valid, id: 'd', kind: 'otro' }, null];

    const result = parseClients(JSON.stringify({ version: 1, clients: [valid, ...bad] }), log);

    expect(result.map((client) => client.id)).toEqual(['a']);
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), { discarded: 4 });
  });
});
