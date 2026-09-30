import { describe, expect, it } from 'vitest';
import { providerAuthSummary } from './providerAuth';
import { ClaudeAdapter } from './claudeAdapter';
import { AgyAdapter } from './agyAdapter';
import { GatewayAdapter } from './gatewayAdapter';
import type { ProviderAdapter } from './providerAdapter';

// Los adapters REALES: lo que se prueba es que el resumen refleja lo que cada uno declara.
function buildAdapter(id: string): ProviderAdapter {
  if (id === 'claude') return new ClaudeAdapter();
  if (id === 'agy') return new AgyAdapter();
  return new GatewayAdapter(id);
}

describe('providerAuthSummary', () => {
  it('providerAuthSummary_cadaProveedor_suTipoDeAlta', () => {
    // Arrange
    const providers = [
      { id: 'claude', label: 'Claude' },
      { id: 'agy', label: 'Antigravity' },
      { id: 'openai', label: 'OpenAI' },
      { id: 'custom:ollama', label: 'Ollama' },
    ];

    // Act
    const summary = providerAuthSummary(providers, buildAdapter);

    // Assert
    expect(summary.map((s) => [s.providerId, s.kind])).toEqual([
      ['claude', 'cli-oauth'],
      ['agy', 'external'],
      ['openai', 'api-key'],
      ['custom:ollama', 'api-key'],
    ]);
    expect(summary[1]?.reason).toMatch(/agy/);
  });

  it('providerAuthSummary_nuncaLlevaUnaClave', () => {
    // Aunque el llamador pasara un objeto con `apiKey`, solo salen las cuatro cadenas descriptivas.
    const summary = providerAuthSummary([{ id: 'custom:x', label: 'X', apiKey: 'sk-secreta' } as never], buildAdapter);

    expect(Object.keys(summary[0] ?? {}).sort()).toEqual(['kind', 'label', 'providerId', 'reason']);
    expect(JSON.stringify(summary)).not.toContain('sk-secreta');
  });

  it('providerAuthSummary_listaVacia_vacia', () => {
    expect(providerAuthSummary([], buildAdapter)).toEqual([]);
  });
});
