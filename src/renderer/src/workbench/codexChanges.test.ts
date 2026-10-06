import { describe, expect, it } from 'vitest';
import { codexChangeView } from './codexChanges';

describe('codexChangeView', () => {
  it('codexChangeView_contenidoConFormaDeCabecera_conservaLasLineasDelHunk', () => {
    const changes = [{ path: 'test.txt', kind: { type: 'update' }, diff: '--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n--- old\n+++ new\n' }];

    const result = codexChangeView(changes);

    expect(result.summary).toBe('+1 −1');
    expect(result.diff).toEqual(expect.arrayContaining([expect.objectContaining({ sign: '-', text: '-- old' }), expect.objectContaining({ sign: '+', text: '++ new' })]));
  });

  it('codexChangeView_cambiosVacios_noInventaContenido', () => {
    const result = codexChangeView([]);

    expect(result.diff).toEqual([]);
    expect(result.summary).toBe('+0 −0');
  });

  it('codexChangeView_entradaMixtaInvalida_rechazaTodaLaLista', () => {
    const input = [{ path: 'test.txt', kind: { type: 'add' }, diff: 'hello\n' }, null];

    const result = codexChangeView(input);

    expect(result).toEqual({ target: 'apply_patch', diff: [], summary: '' });
  });
});
