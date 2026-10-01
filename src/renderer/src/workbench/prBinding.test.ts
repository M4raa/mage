import { describe, expect, it } from 'vitest';
import { isPrCreateCommand, prNumberFromCreatedTag, prNumberFromUrl } from './prBinding';

describe('isPrCreateCommand', () => {
  it('isPrCreateCommand_ghPrCreateEnCualquierSitio_true', () => {
    expect(isPrCreateCommand('git push -u origin HEAD && gh pr create --title "x" --body "y"')).toBe(true);
    expect(isPrCreateCommand('gh  pr   create')).toBe(true);
  });

  it('isPrCreateCommand_otrosGh_false', () => {
    expect(isPrCreateCommand('gh pr view 3')).toBe(false);
    expect(isPrCreateCommand('echo ghpr create')).toBe(false);
    expect(isPrCreateCommand('')).toBe(false);
  });
});

describe('prNumberFromUrl / prNumberFromCreatedTag', () => {
  it('prNumberFromUrl_salidaDeGhPrCreate_numero', () => {
    expect(prNumberFromUrl('Creating pull request…\nhttps://github.com/acme/demo/pull/42\n')).toBe(42);
  });

  it('prNumberFromUrl_sinEnlaceOOtroHost_null', () => {
    expect(prNumberFromUrl('https://gitlab.com/acme/demo/pull/42')).toBeNull();
    expect(prNumberFromUrl('https://github.com/acme/demo/issues/4')).toBeNull();
    expect(prNumberFromUrl('')).toBeNull();
  });

  it('prNumberFromCreatedTag_marca_numero', () => {
    expect(prNumberFromCreatedTag('Listo. <pr-created>https://github.com/acme/demo/pull/9</pr-created>')).toBe(9);
  });

  it('prNumberFromCreatedTag_urlSuelta_null', () => {
    expect(prNumberFromCreatedTag('Mira https://github.com/acme/demo/pull/9')).toBeNull();
    expect(prNumberFromCreatedTag('<pr-created>https://github.com/acme/demo/pull/0</pr-created>')).toBeNull();
  });
});
