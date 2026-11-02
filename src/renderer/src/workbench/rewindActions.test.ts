import { describe, expect, it } from 'vitest';
import type { Translate } from '@shared/i18n/translator';
import { canOfferRewind, divergeTitle, rewindPointOf, unavailableText, type RewindOfferInput } from './rewindActions';
import type { Block } from './types';

const user = (id: string, text: string, nativeId: string | null = null): Block => ({ kind: 'user', id, text, time: '', attachments: [], nativeId });
const system = (id: string): Block => ({ kind: 'system', id, text: 'aviso' });

const offer = (over: Partial<RewindOfferInput> = {}): RewindOfferInput => ({
  provider: 'claude',
  hasLiveSession: true,
  readOnly: false,
  isWrapper: false,
  nativeIdKnown: true,
  ...over,
});

// Traductor de prueba: devuelve la clave y sus valores, que es lo que se quiere comprobar.
const fakeT = ((key: string, values?: object) => (values === undefined ? key : `${key}:${JSON.stringify(values)}`)) as unknown as Translate;

describe('rewindPointOf', () => {
  it('rewindPointOf_secondUser_index1', () => {
    const blocks = [user('a', 'uno', 'u-1'), system('s'), user('b', 'dos', 'u-2')];

    expect(rewindPointOf(blocks, 'b')).toEqual({ userIndex: 1, text: 'dos', nativeId: 'u-2' });
  });

  it('rewindPointOf_toolBlock_null', () => {
    const tool = { kind: 'system', id: 't', text: 'x' } as const;

    expect(rewindPointOf([user('a', 'uno'), tool], 't')).toBeNull();
  });

  it('rewindPointOf_unknownId_null', () => {
    expect(rewindPointOf([user('a', 'uno')], 'zzz')).toBeNull();
  });

  it('rewindPointOf_noBlocks_null', () => {
    expect(rewindPointOf([], 'a')).toBeNull();
  });
});

describe('canOfferRewind', () => {
  it('canOfferRewind_claudeWithNativeId_true', () => {
    expect(canOfferRewind(offer())).toBe(true);
  });

  it('canOfferRewind_agy_false', () => {
    expect(canOfferRewind(offer({ provider: 'agy' }))).toBe(false);
  });

  it('canOfferRewind_claudeWithoutNativeId_false', () => {
    expect(canOfferRewind(offer({ nativeIdKnown: false }))).toBe(false);
  });

  it('canOfferRewind_codexWithoutNativeId_true', () => {
    expect(canOfferRewind(offer({ provider: 'codex', nativeIdKnown: false }))).toBe(true);
  });

  it('canOfferRewind_readOnly_false', () => {
    expect(canOfferRewind(offer({ readOnly: true }))).toBe(false);
  });

  it('canOfferRewind_noLiveSession_false', () => {
    expect(canOfferRewind(offer({ hasLiveSession: false }))).toBe(false);
  });

  it('canOfferRewind_wrapper_false', () => {
    expect(canOfferRewind(offer({ isWrapper: true }))).toBe(false);
  });
});

describe('unavailableText', () => {
  it('unavailableText_unsupported_carriesProvider', () => {
    expect(unavailableText(fakeT, 'unsupported', 'agy')).toBe('errors.rewind.unsupported:{"provider":"agy"}');
  });

  it('unavailableText_legacy_legacyKey', () => {
    expect(unavailableText(fakeT, 'legacy', 'Codex')).toBe('errors.rewind.legacy');
  });
});

describe('divergeTitle', () => {
  it('divergeTitle_namedConversation_tabTitleKey', () => {
    expect(divergeTitle('Arreglar login', fakeT)).toBe('chat.diverge.tabTitle:{"title":"Arreglar login"}');
  });

  it('divergeTitle_placeholder_untitledKey', () => {
    expect(divergeTitle('', fakeT)).toBe('chat.diverge.tabTitleUntitled');
    expect(divergeTitle('Nuevo chat', fakeT)).toBe('chat.diverge.tabTitleUntitled');
  });
});
