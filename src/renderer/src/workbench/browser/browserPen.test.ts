import { describe, expect, it } from 'vitest';
import type { BrowserPenResult } from '@shared/browser';
import type { ImageAttachment } from '@shared/ipc';
import type { Translate } from '../../i18n/uiLanguage';
import type { PromptDraft } from '../types';
import { displayToDip, penCaption, replacePenInDraft } from './browserPen';

const translate = ((key: string, values?: unknown) => `${key}|${JSON.stringify(values)}`) as unknown as Translate;
const LOCALE = 'es-ES';
const image = (data: string): ImageAttachment => ({ mediaType: 'image/png', data });
const pending = (data: string) => ({ attachment: image(data), byteLength: 4 });
const draftOf = (text: string, attachments: PromptDraft['attachments'] = []): PromptDraft => ({ text, attachments, mentions: [] });
const resultOf = (elementsText: string, strokesText: string): BrowserPenResult => ({
  attachment: image('AAAA'),
  elementsText,
  strokesText,
  url: 'http://localhost:3000/',
});

describe('displayToDip', () => {
  it('displayToDip_halfSize_doubles', () => {
    expect(displayToDip({ x: 50, y: 25 }, { width: 100, height: 50 }, { width: 200, height: 100 })).toEqual([100, 50]);
  });

  it('displayToDip_outside_clamped', () => {
    expect(displayToDip({ x: -10, y: 80 }, { width: 100, height: 50 }, { width: 200, height: 100 })).toEqual([0, 100]);
  });

  it('displayToDip_zeroDisplayed_throws', () => {
    expect(() => displayToDip({ x: 1, y: 1 }, { width: 0, height: 50 }, { width: 200, height: 100 })).toThrow('0x50');
  });
});

describe('penCaption', () => {
  it('penCaption_withElementsAndStrokes_threeParts', () => {
    const lines = penCaption(translate, resultOf('1: a', '1: caja')).split('\n');

    expect(lines).toEqual([
      'chat.browser.penCaptionHeader|{"url":"http://localhost:3000/"}',
      'chat.browser.penCaptionElements|{"list":"1: a"}',
      'chat.browser.penCaptionStrokes|{"list":"1: caja"}',
    ]);
  });

  it('penCaption_noElements_noElementsLine', () => {
    expect(penCaption(translate, resultOf('', '1: caja')).split('\n')[1]).toBe('chat.browser.penCaptionNoElements|undefined');
  });

  it('penCaption_noStrokes_noStrokesLine', () => {
    expect(penCaption(translate, resultOf('1: a', '')).split('\n')).toHaveLength(2);
  });
});

describe('replacePenInDraft', () => {
  const next = { attachment: image('BBBB'), caption: 'CAP2' };

  it('replacePenInDraft_emptyDraft_captionAndAttachment', () => {
    const result = replacePenInDraft(draftOf(''), null, next, LOCALE);

    expect(result.text).toBe('CAP2');
    expect(result.attachments).toEqual([{ attachment: next.attachment, byteLength: 3 }]);
  });

  it('replacePenInDraft_withText_appendsAfterBlankLine', () => {
    expect(replacePenInDraft(draftOf('mira esto  '), null, next, LOCALE).text).toBe('mira esto\n\nCAP2');
  });

  it('replacePenInDraft_previousPen_replacedNotDuplicated', () => {
    const draft = draftOf('hola\n\nCAP1', [pending('OTRO'), pending('AAAA')]);

    const result = replacePenInDraft(draft, { data: 'AAAA', caption: 'CAP1' }, next, LOCALE);

    expect(result.text).toBe('hola\n\nCAP2');
    expect(result.attachments.map((p) => p.attachment.data)).toEqual(['OTRO', 'BBBB']);
  });

  it('replacePenInDraft_tooManyAttachments_throws', () => {
    const many = Array.from({ length: 10 }, (_, i) => pending(`IMG${i}`));

    expect(() => replacePenInDraft(draftOf('', many), null, next, LOCALE)).toThrow();
  });

  it('replacePenInDraft_keepsMentions', () => {
    const mention = { path: 'a.ts' } as unknown as PromptDraft['mentions'][number];

    expect(replacePenInDraft({ ...draftOf('x'), mentions: [mention] }, null, next, LOCALE).mentions).toEqual([mention]);
  });
});
