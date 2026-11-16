import { describe, expect, it, vi } from 'vitest';
import type { MentionCandidate } from '@shared/mentions';
import { fileMentionOf, insertAtCursor, isAttachableImage, relativeToCwd } from './fileAttach';

const candidate = (relPath: string): MentionCandidate => ({ relPath, absPath: `/p/${relPath}`, kind: 'text', bytes: 1 });

describe('isAttachableImage', () => {
  it('isAttachableImage_png_true', () => expect(isAttachableImage({ type: 'image/png' })).toBe(true));
  it('isAttachableImage_svg_false', () => expect(isAttachableImage({ type: 'image/svg+xml' })).toBe(false));
  it('isAttachableImage_pdf_false', () => expect(isAttachableImage({ type: 'application/pdf' })).toBe(false));
});

describe('relativeToCwd', () => {
  it('relativeToCwd_dentroEnWindowsConOtrasMayusculas_relativaConBarras', () => {
    expect(relativeToCwd('C:\\Proj\\App', 'c:\\proj\\app\\docs\\a.pdf')).toBe('docs/a.pdf');
  });
  it('relativeToCwd_carpetaConPrefijoParecido_null', () => {
    expect(relativeToCwd('/home/u/app', '/home/u/app2/a.txt')).toBeNull();
  });
  it('relativeToCwd_laPropiaCarpeta_null', () => expect(relativeToCwd('/home/u/app', '/home/u/app/')).toBeNull());
  it('relativeToCwd_cwdVacio_null', () => expect(relativeToCwd('', '/a/b.txt')).toBeNull());
});

describe('insertAtCursor', () => {
  it('insertAtCursor_trasTextoSinEspacio_anteponeEspacio', () => {
    const next = insertAtCursor({ value: 'hola', selectionStart: 4, selectionEnd: 4 }, '@a.md ');
    expect(next).toEqual({ value: 'hola @a.md ', selectionStart: 11, selectionEnd: 11 });
  });
  it('insertAtCursor_conSeleccion_laSustituye', () => {
    const next = insertAtCursor({ value: 'a XX b', selectionStart: 2, selectionEnd: 4 }, '@a.md ');
    expect(next).toEqual({ value: 'a @a.md  b', selectionStart: 8, selectionEnd: 8 });
  });
});

describe('fileMentionOf', () => {
  it('fileMentionOf_sinRuta_noPath', async () => {
    const lookup = vi.fn();
    expect(await fileMentionOf('x.exe', '', { cwd: '/p', lookup })).toEqual({ kind: 'noPath', name: 'x.exe' });
  });
  it('fileMentionOf_fueraDeLaCarpeta_pathSinBuscar', async () => {
    const lookup = vi.fn();
    expect(await fileMentionOf('a.txt', '/otra/a.txt', { cwd: '/p', lookup })).toEqual({ kind: 'path', absPath: '/otra/a.txt' });
    expect(lookup).not.toHaveBeenCalled();
  });
  it('fileMentionOf_dentroYIndexado_mention', async () => {
    const found = candidate('a.md');
    const lookup = vi.fn().mockResolvedValue(found);
    expect(await fileMentionOf('a.md', '/p/a.md', { cwd: '/p', lookup })).toEqual({ kind: 'mention', candidate: found });
    expect(lookup).toHaveBeenCalledWith('a.md');
  });
  it('fileMentionOf_dentroSinIndexar_path', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    expect(await fileMentionOf('a.md', '/p/a.md', { cwd: '/p', lookup })).toEqual({ kind: 'path', absPath: '/p/a.md' });
  });
});
