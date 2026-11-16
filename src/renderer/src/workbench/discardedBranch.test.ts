import { describe, expect, it } from 'vitest';
import { DISCARDED_ID_PREFIX, discardedBranchOf } from './discardedBranch';
import type { Block } from './types';

const user = (id: string): Block => ({ kind: 'user', id, text: 'hola', time: '', attachments: [], nativeId: null });
const agent = (id: string): Block => ({ kind: 'agent', id, runs: [{ code: false, text: 'ok' }], streaming: false });

describe('discardedBranchOf', () => {
  it('discardedBranchOf_puntoEnMedio_desdeElPuntoConIdsPrefijados', () => {
    const blocks = [user('u1'), agent('a1'), user('u2')];

    const result = discardedBranchOf(blocks, 'a1');

    expect(result.map((b) => b.id)).toEqual([`${DISCARDED_ID_PREFIX}a1`, `${DISCARDED_ID_PREFIX}u2`]);
  });

  it('discardedBranchOf_bloqueInexistente_vacio', () => {
    expect(discardedBranchOf([user('u1')], 'nope')).toEqual([]);
  });

  it('discardedBranchOf_listaVacia_vacio', () => {
    expect(discardedBranchOf([], 'u1')).toEqual([]);
  });
});
