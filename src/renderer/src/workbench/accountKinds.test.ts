import { describe, expect, it } from 'vitest';
import { ACCOUNT_KINDS, ACCOUNT_VENDORS, accountHomeHint, accountKindsFor } from './accountKinds';

describe('accountKinds (matriz fabricante × forma de pago)', () => {
  it('accountKindsFor_cadaFabricante_tieneAlMenosUnaForma', () => {
    for (const vendor of ACCOUNT_VENDORS) expect(accountKindsFor(vendor.id).length).toBeGreaterThan(0);
  });

  // Respuesta 3: Anthropic, OpenAI y Google por suscripcion y por API, y local.
  it('ACCOUNT_KINDS_matriz_lasSieteCeldas', () => {
    expect(ACCOUNT_KINDS.map((k) => `${k.vendor}:${k.payment}`)).toEqual([
      'anthropic:subscription',
      'anthropic:api-key',
      'openai:subscription',
      'openai:api-key',
      'google:subscription',
      'google:api-key',
      'local:endpoint',
    ]);
  });

  it('ACCOUNT_KINDS_codex_sinVerificar', () => {
    expect(ACCOUNT_KINDS.filter((k) => k.unverified).every((k) => k.providerId === 'codex')).toBe(true);
  });

  it.each([
    [0, 'trabajo', '~/.claude-trabajo'],
    [3, '', '~/.codex-<nombre>'],
    [5, 'gem', 'perfil de Mage «agy-gem»'],
  ])('accountHomeHint_%s_%s', (index, name, expected) => {
    expect(accountHomeHint(ACCOUNT_KINDS[index]!, name)).toBe(expected);
  });
});
