import { describe, expect, it, vi } from 'vitest';
import type { ImageAttachment } from '@shared/ipc';
import { base64ToBlob, copyTextAndImage, firstImageOf, type ClipboardDeps } from './clipboardContent';

const png: ImageAttachment = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
const pdf: ImageAttachment = { mediaType: 'application/pdf', data: 'JVBERi0=' };

function makeDeps(overrides: Partial<ClipboardDeps['clipboard']> = {}) {
  const writeText = vi.fn(async () => undefined);
  const write = vi.fn(async (_items: ClipboardItem[]) => undefined);
  const toPng = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
  const makeItem = vi.fn((items: Record<string, Blob>) => items as unknown as ClipboardItem);
  const deps: ClipboardDeps = { clipboard: { writeText, write, ...overrides }, makeItem, toPng };
  return { deps, writeText, write, toPng, makeItem };
}

describe('copyTextAndImage', () => {
  it('copyTextAndImage_sinImagen_usaWriteText', async () => {
    const { deps, writeText, write } = makeDeps();

    const result = await copyTextAndImage(deps, { text: 'hola', image: null });

    expect(writeText).toHaveBeenCalledWith('hola');
    expect(write).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('copyTextAndImage_conImagen_escribeUnElementoConTextoYPng', async () => {
    const { deps, write } = makeDeps();

    const result = await copyTextAndImage(deps, { text: 'mira [Imagen 1]', image: png });

    expect(result).toBeNull();
    const items = write.mock.calls[0]?.[0] as unknown as Record<string, Blob>[];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!)).toEqual(['text/plain', 'image/png']);
    expect(await items[0]!['text/plain']!.text()).toBe('mira [Imagen 1]');
  });

  it('copyTextAndImage_elPortapapelesFalla_devuelveElMensaje', async () => {
    const { deps } = makeDeps({ write: vi.fn(async () => Promise.reject(new Error('denegado'))) });

    const result = await copyTextAndImage(deps, { text: 'x', image: png });

    expect(result).toContain('denegado');
  });
});

describe('firstImageOf', () => {
  it('firstImageOf_pdfYPng_devuelveLaPng', () => {
    expect(firstImageOf([pdf, png])).toBe(png);
  });

  it('firstImageOf_soloPdf_null', () => {
    expect(firstImageOf([pdf])).toBeNull();
  });

  it('firstImageOf_vacio_null', () => {
    expect(firstImageOf([])).toBeNull();
  });
});

describe('base64ToBlob', () => {
  it('base64ToBlob_png_tipoYBytes', () => {
    const blob = base64ToBlob('AAEC', 'image/png');

    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });
});
