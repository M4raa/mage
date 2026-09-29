import { describe, expect, it, vi } from 'vitest';
import { copyText } from './useCopyToClipboard';

describe('copyText', () => {
  it('portapapelesOk_escribeElTextoYDevuelveNull', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    const result = await copyText({ writeText }, '**md** crudo');

    expect(writeText).toHaveBeenCalledWith('**md** crudo');
    expect(result).toBeNull();
  });

  it('portapapelesFalla_devuelveMensajeConElMotivo', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denegado'));

    expect(await copyText({ writeText }, 'x')).toBe('No se pudo copiar: denegado');
  });
});
