import { describe, expect, it } from 'vitest';
import { comboFromEvent, displayKeyCombo, formatKeyCombo, isBareAlphanumeric, matchesKeyboardEvent, parseKeyCombo } from './keyParser';
import type { KeyEventLike } from './keyParser';

const NO_MODS: Omit<KeyEventLike, 'code'> = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe('parseKeyCombo', () => {
  it('combinacionSimple_devuelveCodeYSinModificadores', () => {
    expect(parseKeyCombo('N')).toEqual({ cmdOrCtrl: false, alt: false, shift: false, code: 'KeyN' });
  });

  it('combinacionConModificadores_respetaCadaFlag', () => {
    expect(parseKeyCombo('CmdOrCtrl+Shift+K')).toEqual({ cmdOrCtrl: true, alt: false, shift: true, code: 'KeyK' });
  });

  it('digitoSuelto_parseaComoDigitCode', () => {
    expect(parseKeyCombo('1')).toEqual({ cmdOrCtrl: false, alt: false, shift: false, code: 'Digit1' });
  });

  it('cadenaVacia_devuelveNull', () => {
    expect(parseKeyCombo('')).toBeNull();
    expect(parseKeyCombo('   ')).toBeNull();
  });

  it('modificadorDesconocido_devuelveNull', () => {
    expect(parseKeyCombo('Meta+N')).toBeNull();
  });

  it('modificadorDuplicado_devuelveNull', () => {
    expect(parseKeyCombo('Shift+Shift+N')).toBeNull();
  });

  it('teclaFinalDesconocida_devuelveNull', () => {
    expect(parseKeyCombo('CmdOrCtrl+MediaPlayPause')).toBeNull();
  });

  it('tokenVacioPorDoblePlus_devuelveNull', () => {
    expect(parseKeyCombo('CmdOrCtrl++N')).toBeNull();
  });
});

describe('formatKeyCombo', () => {
  it('comboCompleto_ordenaModificadoresFijo', () => {
    expect(formatKeyCombo({ cmdOrCtrl: true, alt: true, shift: true, code: 'KeyK' })).toBe('CmdOrCtrl+Alt+Shift+K');
  });

  it('sinModificadores_devuelveSoloLaTecla', () => {
    expect(formatKeyCombo({ cmdOrCtrl: false, alt: false, shift: false, code: 'Tab' })).toBe('Tab');
  });

  it('codeDesconocido_devuelveNull', () => {
    expect(formatKeyCombo({ cmdOrCtrl: false, alt: false, shift: false, code: 'ContextMenu' })).toBeNull();
  });

  it('roundTrip_parseoYFormatoConservanLaCombinacion', () => {
    const original = 'CmdOrCtrl+Shift+Tab';
    expect(formatKeyCombo(parseKeyCombo(original)!)).toBe(original);
  });
});

describe('matchesKeyboardEvent', () => {
  const combo = { cmdOrCtrl: true, alt: false, shift: false, code: 'KeyN' };

  it('eventoIdenticoEnWindows_devuelveTrue', () => {
    const event: KeyEventLike = { ...NO_MODS, code: 'KeyN', ctrlKey: true };
    expect(matchesKeyboardEvent(combo, event, false)).toBe(true);
  });

  it('eventoConCtrlEnMac_noCuentaComoCmdOrCtrl', () => {
    // En mac, CmdOrCtrl resuelve a metaKey; ctrlKey solo no basta.
    const event: KeyEventLike = { ...NO_MODS, code: 'KeyN', ctrlKey: true };
    expect(matchesKeyboardEvent(combo, event, true)).toBe(false);
  });

  it('eventoConMetaEnMac_cuentaComoCmdOrCtrl', () => {
    const event: KeyEventLike = { ...NO_MODS, code: 'KeyN', metaKey: true };
    expect(matchesKeyboardEvent(combo, event, true)).toBe(true);
  });

  it('modificadorExtraNoEsperado_devuelveFalse', () => {
    const event: KeyEventLike = { ...NO_MODS, code: 'KeyN', ctrlKey: true, shiftKey: true };
    expect(matchesKeyboardEvent(combo, event, false)).toBe(false);
  });

  it('codeDistinto_devuelveFalse', () => {
    const event: KeyEventLike = { ...NO_MODS, code: 'KeyM', ctrlKey: true };
    expect(matchesKeyboardEvent(combo, event, false)).toBe(false);
  });
});

describe('comboFromEvent', () => {
  it('eventoSoportado_construyeCombo', () => {
    const event: KeyEventLike = { ...NO_MODS, code: 'BracketLeft', shiftKey: true };
    expect(comboFromEvent(event, false)).toEqual({ cmdOrCtrl: false, alt: false, shift: true, code: 'BracketLeft' });
  });

  it('codeNoSoportado_devuelveNull', () => {
    const event: KeyEventLike = { ...NO_MODS, code: 'MediaPlayPause' };
    expect(comboFromEvent(event, false)).toBeNull();
  });
});

describe('displayKeyCombo', () => {
  it('windows_usaEtiquetaCtrl', () => {
    expect(displayKeyCombo({ cmdOrCtrl: true, alt: false, shift: false, code: 'KeyB' }, false)).toBe('Ctrl+B');
  });

  it('mac_usaSimboloCmd', () => {
    expect(displayKeyCombo({ cmdOrCtrl: true, alt: false, shift: false, code: 'KeyB' }, true)).toBe('⌘+B');
  });
});

describe('isBareAlphanumeric', () => {
  it('letraSinModificador_devuelveTrue', () => {
    expect(isBareAlphanumeric({ cmdOrCtrl: false, alt: false, shift: false, code: 'KeyA' })).toBe(true);
  });

  it('digitoSinModificador_devuelveTrue', () => {
    expect(isBareAlphanumeric({ cmdOrCtrl: false, alt: false, shift: false, code: 'Digit1' })).toBe(true);
  });

  it('letraConModificador_devuelveFalse', () => {
    expect(isBareAlphanumeric({ cmdOrCtrl: true, alt: false, shift: false, code: 'KeyA' })).toBe(false);
  });

  it('teclaNoAlfanumericaSinModificador_devuelveFalse', () => {
    expect(isBareAlphanumeric({ cmdOrCtrl: false, alt: false, shift: false, code: 'Tab' })).toBe(false);
    expect(isBareAlphanumeric({ cmdOrCtrl: false, alt: false, shift: false, code: 'Escape' })).toBe(false);
  });
});
