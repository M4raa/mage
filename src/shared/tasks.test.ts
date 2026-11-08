import { describe, expect, it } from 'vitest';
import { lastFencedBlock, parseDeliverables, parsePlan, taskVerdictOf, TASK_LIMITS, type DeliverableCheck, type DeliverableStatus } from './tasks';

const F = '`'.repeat(3);
const block = (info: string, body: string): string => `${F}${info}\n${body}\n${F}`;

function check(status: DeliverableStatus): DeliverableCheck {
  return { declared: 'a', path: '/a', status, bytes: null, modifiedAtMs: null, kind: '' };
}

describe('lastFencedBlock', () => {
  it('lastFencedBlock_dosBloques_devuelveElUltimo', () => {
    const text = `${block('x', 'uno')}\ntexto\n${block('x', 'dos')}`;
    expect(lastFencedBlock(text, 'x')).toBe('dos');
  });
  it('lastFencedBlock_sinCierre_devuelveNull', () => {
    expect(lastFencedBlock(`${F}x\nuno`, 'x')).toBeNull();
  });
  it('lastFencedBlock_crlf_devuelveContenido', () => {
    expect(lastFencedBlock(`${F}x \r\na\r\nb\r\n${F}\r\n`, 'x')).toBe('a\nb');
  });
  it('lastFencedBlock_otraEtiqueta_devuelveNull', () => {
    expect(lastFencedBlock(block('y', 'uno'), 'x')).toBeNull();
  });
});

describe('parseDeliverables', () => {
  it('parseDeliverables_jsonValido_devuelveRutasRecortadasSinDuplicados', () => {
    const text = block('mage-deliverables', '[" a.md ", "b.md", "a.md"]');
    expect(parseDeliverables(text)).toEqual(['a.md', 'b.md']);
  });
  it('parseDeliverables_jsonRoto_devuelveNull', () => {
    expect(parseDeliverables(block('mage-deliverables', '["a.md"'))).toBeNull();
  });
  it('parseDeliverables_noArray_devuelveNull', () => {
    expect(parseDeliverables(block('mage-deliverables', '{"a":1}'))).toBeNull();
  });
  it('parseDeliverables_cadenaVacia_devuelveNull', () => {
    expect(parseDeliverables(block('mage-deliverables', '["  "]'))).toBeNull();
  });
  it('parseDeliverables_masDelMaximo_devuelveNull', () => {
    const many = JSON.stringify(Array.from({ length: TASK_LIMITS.maxDeliverables + 1 }, (_, i) => `f${i}.md`));
    expect(parseDeliverables(block('mage-deliverables', many))).toBeNull();
  });
  it('parseDeliverables_sinBloque_devuelveNull', () => {
    expect(parseDeliverables('nada')).toBeNull();
  });
});

describe('parsePlan', () => {
  it('parsePlan_casillasMarcadasYNo_devuelvePasos', () => {
    const text = block('mage-plan', '- [ ] uno\n* [x] dos\nruido\n  - [X] tres');
    expect(parsePlan(text)).toEqual([
      { text: 'uno', done: false },
      { text: 'dos', done: true },
      { text: 'tres', done: true },
    ]);
  });
  it('parsePlan_sinPasos_devuelveNull', () => {
    expect(parsePlan(block('mage-plan', 'solo texto'))).toBeNull();
  });
});

describe('taskVerdictOf', () => {
  it('taskVerdictOf_vacia_incomplete', () => {
    expect(taskVerdictOf([])).toBe('incomplete');
  });
  it('taskVerdictOf_todosOk_verified', () => {
    expect(taskVerdictOf([check('ok'), check('ok')])).toBe('verified');
  });
  it('taskVerdictOf_unoMissing_incomplete', () => {
    expect(taskVerdictOf([check('ok'), check('missing')])).toBe('incomplete');
  });
});
