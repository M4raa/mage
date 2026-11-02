import { describe, expect, it } from 'vitest';
import { addAlwaysAllow, isAlwaysAllowed, removeAlwaysAllow, sanitizeAlwaysAllow } from './permissionRules';

describe('isAlwaysAllowed', () => {
  it('isAlwaysAllowed_toolConRegla_true', () => {
    expect(isAlwaysAllowed(['Write', 'Bash'], 'Bash')).toBe(true);
  });

  it('isAlwaysAllowed_toolSinRegla_false', () => {
    expect(isAlwaysAllowed(['Write'], 'Bash')).toBe(false);
  });

  it('isAlwaysAllowed_sinReglas_false', () => {
    expect(isAlwaysAllowed([], 'Write')).toBe(false);
  });

  it('isAlwaysAllowed_toolVacia_false', () => {
    // Un nombre vacio no puede casar con nada: si casara, una regla vacia en el fichero autorizaria
    // cualquier tool sin nombre.
    expect(isAlwaysAllowed([''], '   ')).toBe(false);
  });

  it('isAlwaysAllowed_distintaCaja_false', () => {
    // Los nombres de tool del CLI son sensibles a mayusculas (`Write`, `Bash`, `mcp__x__y`): casar
    // `write` con `Write` autorizaria una tool distinta de la que el usuario vio.
    expect(isAlwaysAllowed(['Write'], 'write')).toBe(false);
  });
});

describe('addAlwaysAllow', () => {
  it('addAlwaysAllow_toolNueva_laAñadeAlFinal', () => {
    expect(addAlwaysAllow(['Write'], 'Bash')).toEqual(['Write', 'Bash']);
  });

  it('addAlwaysAllow_toolRepetida_devuelveElMismoArray', () => {
    const rules = ['Write'];
    expect(addAlwaysAllow(rules, 'Write')).toBe(rules);
  });

  it('addAlwaysAllow_toolVacia_devuelveElMismoArray', () => {
    const rules = ['Write'];
    expect(addAlwaysAllow(rules, '  ')).toBe(rules);
  });

  it('addAlwaysAllow_conEspacios_guardaElNombreLimpio', () => {
    expect(addAlwaysAllow([], ' Write ')).toEqual(['Write']);
  });
});

describe('removeAlwaysAllow', () => {
  it('removeAlwaysAllow_toolConRegla_laQuita', () => {
    expect(removeAlwaysAllow(['Write', 'Bash'], 'Write')).toEqual(['Bash']);
  });

  it('removeAlwaysAllow_toolSinRegla_devuelveElMismoArray', () => {
    const rules = ['Write'];
    expect(removeAlwaysAllow(rules, 'Bash')).toBe(rules);
  });

  it('removeAlwaysAllow_ultimaRegla_dejaListaVacia', () => {
    expect(removeAlwaysAllow(['Write'], 'Write')).toEqual([]);
  });
});

describe('sanitizeAlwaysAllow', () => {
  it('sanitizeAlwaysAllow_undefined_listaVacia', () => {
    expect(sanitizeAlwaysAllow(undefined)).toEqual([]);
  });

  it('sanitizeAlwaysAllow_conVaciosYDuplicados_losQuitaConservandoOrden', () => {
    expect(sanitizeAlwaysAllow([' Write ', '', 'Bash', 'Write', '   '])).toEqual(['Write', 'Bash']);
  });
});
