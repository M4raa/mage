import { describe, expect, it } from 'vitest';
import { shouldFocusPromptOnClick, type PromptFocusClick } from './promptFocus';

// Un elemento falso: `closest` devuelve algo si el selector que se le pasa menciona alguna de sus marcas.
function fakeTarget(marks: readonly string[]) {
  return { closest: (selector: string) => (marks.some((mark) => selector.includes(mark)) ? {} : null) };
}

function click(overrides: Partial<PromptFocusClick> = {}): PromptFocusClick {
  const target = overrides.target ?? fakeTarget([]);
  return {
    button: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    target,
    currentTarget: { contains: () => true },
    selectionCollapsed: true,
    ...overrides,
  };
}

describe('shouldFocusPromptOnClick', () => {
  it('shouldFocusPromptOnClick_clicSimpleEnHueco_enfoca', () => {
    expect(shouldFocusPromptOnClick(click())).toBe(true);
  });

  it('shouldFocusPromptOnClick_botonSecundario_noEnfoca', () => {
    expect(shouldFocusPromptOnClick(click({ button: 2 }))).toBe(false);
    expect(shouldFocusPromptOnClick(click({ button: 1 }))).toBe(false);
  });

  it('shouldFocusPromptOnClick_conModificador_noEnfoca', () => {
    expect(shouldFocusPromptOnClick(click({ ctrlKey: true }))).toBe(false);
    expect(shouldFocusPromptOnClick(click({ shiftKey: true }))).toBe(false);
    expect(shouldFocusPromptOnClick(click({ altKey: true }))).toBe(false);
    expect(shouldFocusPromptOnClick(click({ metaKey: true }))).toBe(false);
  });

  it('shouldFocusPromptOnClick_seleccionNoColapsada_noEnfoca', () => {
    expect(shouldFocusPromptOnClick(click({ selectionCollapsed: false }))).toBe(false);
  });

  it('shouldFocusPromptOnClick_sobreBotonOEnlace_noEnfoca', () => {
    expect(shouldFocusPromptOnClick(click({ target: fakeTarget(['button']) }))).toBe(false);
    expect(shouldFocusPromptOnClick(click({ target: fakeTarget(['[role="menuitem"]']) }))).toBe(false);
  });

  it('shouldFocusPromptOnClick_dentroDelEditor_noEnfoca', () => {
    expect(shouldFocusPromptOnClick(click({ target: fakeTarget(['.cm-editor']) }))).toBe(false);
  });

  it('shouldFocusPromptOnClick_desdeUnPortal_noEnfoca', () => {
    expect(shouldFocusPromptOnClick(click({ currentTarget: { contains: () => false } }))).toBe(false);
  });
});
