import { describe, expect, it } from 'vitest';
import { classifyMention } from './mentionKind';

const EMPTY = new Uint8Array();

describe('classifyMention', () => {
  it('classifyMention_imageExtensions_mime', () => {
    expect(classifyMention('a.png', EMPTY)).toEqual({ kind: 'image', mime: 'image/png' });
    expect(classifyMention('a.jpg', EMPTY).mime).toBe('image/jpeg');
    expect(classifyMention('a.jpeg', EMPTY).mime).toBe('image/jpeg');
    expect(classifyMention('a.webp', EMPTY).mime).toBe('image/webp');
    expect(classifyMention('a.gif', EMPTY).mime).toBe('image/gif');
  });

  it('classifyMention_pdf', () => {
    expect(classifyMention('docs/a.pdf', EMPTY)).toEqual({ kind: 'pdf', mime: 'application/pdf' });
  });

  it('classifyMention_docx_binary', () => {
    expect(classifyMention('a.docx', EMPTY)).toEqual({ kind: 'binary', mime: 'application/octet-stream' });
  });

  it('classifyMention_unknownWithNul_binary', () => {
    expect(classifyMention('data.xyz', new Uint8Array([65, 0, 66])).kind).toBe('binary');
  });

  it('classifyMention_tsWithoutNul_text', () => {
    expect(classifyMention('a.ts', new Uint8Array([65, 66]))).toEqual({ kind: 'text', mime: 'text/plain' });
  });

  it('classifyMention_upperCaseExtension', () => {
    expect(classifyMention('A.PNG', EMPTY).kind).toBe('image');
    expect(classifyMention('A.PDF', EMPTY).kind).toBe('pdf');
  });
});
