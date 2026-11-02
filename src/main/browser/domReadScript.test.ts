import { describe, expect, it, vi } from 'vitest';
import { buildDomReadScript } from './domReadScript';
import { DEFAULT_DOM_SELECTOR, parseDomSnapshot } from './domSnapshot';

// Ejecuta el script contra un documento falso, sin tocar globales.
const run = (script: string, document: unknown) =>
  new Function('document', `return ${script};`)(document) as unknown;

interface FakeElementInit {
  tag: string;
  attrs?: Record<string, string>;
  rect: [number, number, number, number];
  innerText?: string;
  value?: string;
  labelText?: string;
}

function fakeElement({ tag, attrs = {}, rect, innerText = '', value = '', labelText }: FakeElementInit) {
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (name: string) => attrs[name] ?? null,
    getBoundingClientRect: () => ({ x: rect[0], y: rect[1], width: rect[2], height: rect[3] }),
    innerText,
    value,
    labels: labelText === undefined ? null : [{ innerText: labelText }],
  };
}

const fakeDocument = (elements: unknown[]) => ({ querySelectorAll: vi.fn(() => elements) });
const options = (maxNodes = 200, selector = DEFAULT_DOM_SELECTOR) => ({ selector, maxNodes });

describe('buildDomReadScript', () => {
  it('buildDomReadScript_fakeDocument_returnsVisibleElementsWithRoles', () => {
    const document = fakeDocument([
      fakeElement({ tag: 'button', innerText: 'Enviar', rect: [178.4, 67, 29, 21] }),
      fakeElement({ tag: 'input', attrs: { placeholder: 'Buscar' }, rect: [8, 67, 170, 21] }),
      fakeElement({ tag: 'div', attrs: { role: 'tab' }, innerText: '  Pestaña\n uno ', rect: [0, 0, 50, 20] }),
      fakeElement({ tag: 'a', rect: [0, 0, 0, 10] }),
    ]);

    const result = run(buildDomReadScript(options()), document);

    expect(result).toEqual([
      { role: 'button', name: 'Enviar', rectDip: [178, 67, 29, 21] },
      { role: 'textbox', name: 'Buscar', rectDip: [8, 67, 170, 21] },
      { role: 'tab', name: 'Pestaña uno', rectDip: [0, 0, 50, 20] },
    ]);
    expect(() => parseDomSnapshot(result, 200)).not.toThrow();
  });

  it('buildDomReadScript_passwordInput_neverExposesValue', () => {
    const document = fakeDocument([
      fakeElement({ tag: 'input', attrs: { type: 'password' }, value: 'secreto', rect: [0, 0, 10, 10] }),
    ]);

    const result = run(buildDomReadScript(options()), document);

    expect(result).toEqual([{ role: 'textbox', name: '', rectDip: [0, 0, 10, 10] }]);
  });

  it('buildDomReadScript_labelledInput_usesLabelText', () => {
    const document = fakeDocument([
      fakeElement({ tag: 'input', value: 'x@y', labelText: 'Correo', rect: [0, 0, 10, 10] }),
    ]);

    const result = run(buildDomReadScript(options()), document) as { name: string }[];

    expect(result[0]?.name).toBe('Correo');
  });

  it.each([
    ['input', 'checkbox', 'checkbox'],
    ['input', 'radio', 'radio'],
    ['input', 'submit', 'button'],
    ['input', 'email', 'textbox'],
    ['select', undefined, 'combobox'],
    ['textarea', undefined, 'textbox'],
    ['a', undefined, 'link'],
  ])('buildDomReadScript_inputTypes_mapToRoles (%s %s)', (tag, type, role) => {
    const attrs: Record<string, string> = type === undefined ? {} : { type };
    const document = fakeDocument([fakeElement({ tag, attrs, rect: [0, 0, 10, 10] })]);

    const result = run(buildDomReadScript(options()), document) as { role: string }[];

    expect(result[0]?.role).toBe(role);
  });

  it('buildDomReadScript_maxNodes_stopsAtLimit', () => {
    const buttons = [1, 2, 3].map(() => fakeElement({ tag: 'button', rect: [0, 0, 10, 10] }));

    const result = run(buildDomReadScript(options(1)), fakeDocument(buttons)) as unknown[];

    expect(result).toHaveLength(1);
  });

  it('buildDomReadScript_hostileSelector_isPassedAsData', () => {
    const hostile = 'a"]); globalThis.pwned = 1; (["';
    const document = fakeDocument([]);

    run(buildDomReadScript(options(200, hostile)), document);

    expect(document.querySelectorAll).toHaveBeenCalledWith(hostile);
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });

  it('buildDomReadScript_longName_isTruncated', () => {
    const document = fakeDocument([
      fakeElement({ tag: 'button', innerText: 'x'.repeat(300), rect: [0, 0, 10, 10] }),
    ]);

    const result = run(buildDomReadScript(options()), document) as { name: string }[];

    expect(result[0]?.name).toHaveLength(200);
  });

  it('buildDomReadScript_nonIntegerMaxNodes_throws', () => {
    expect(() => buildDomReadScript({ selector: 'a', maxNodes: 1.5 })).toThrow(/no es entero/);
  });
});
