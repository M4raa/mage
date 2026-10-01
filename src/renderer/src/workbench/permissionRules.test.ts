import { describe, expect, it } from 'vitest';
import { addAlwaysAllow, isAlwaysAllowed, prTurnBlockReason, removeAlwaysAllow, sanitizeAlwaysAllow } from './permissionRules';

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

describe('prTurnBlockReason', () => {
  it('prTurnBlockReason_pushNormalYGhPrCreateSimple_null', () => {
    expect(prTurnBlockReason('git push -u origin HEAD')).toBeNull();
    expect(prTurnBlockReason('git add -A && git commit -m "arregla x" && git push')).toBeNull();
    expect(prTurnBlockReason('gh pr create --title "x" --body "y" --draft')).toBeNull();
  });

  it('prTurnBlockReason_pushForzado_bloquea', () => {
    expect(prTurnBlockReason('git push --force origin rama')).toBe('git push --force');
    expect(prTurnBlockReason('git push --force-with-lease')).toBe('git push --force-with-lease');
    expect(prTurnBlockReason('git push -fu origin rama')).toBe('git push -fu');
    expect(prTurnBlockReason('git push origin +rama')).toBe('git push +rama');
    expect(prTurnBlockReason('git -C repo push --no-verify')).toBe('git push --no-verify');
  });

  it('prTurnBlockReason_commitQueSaltaHooksOReescribe_bloquea', () => {
    expect(prTurnBlockReason('git commit --amend --no-edit')).toBe('git commit --amend');
    expect(prTurnBlockReason('git commit -n -m x')).toBe('git commit -n');
    expect(prTurnBlockReason('git commit -F msg.txt')).toBe('git commit -F');
  });

  it('prTurnBlockReason_ghPrCreateEnOtroRepo_bloquea', () => {
    expect(prTurnBlockReason('gh pr create --repo otro/repo --fill')).toBe('gh pr create --repo');
    expect(prTurnBlockReason('cd x; gh pr create -H fork:rama')).toBe('gh pr create -H');
  });

  it('prTurnBlockReason_vacioOComandoAjeno_null', () => {
    expect(prTurnBlockReason('')).toBeNull();
    expect(prTurnBlockReason('pnpm test --force')).toBeNull();
  });
});
