import { describe, expect, it } from 'vitest';
import { readOnlyLockMessage } from './conversationLock';
import { foreignText, localized, renderLocalized } from './i18n/localizedText';
import { createTranslator } from './i18n/translator';

describe('readOnlyLockMessage', () => {
  it('readOnlyLockMessage_perfilComoTexto_llevaElPerfilComoParte', () => {
    const profile = foreignText('dev');

    expect(readOnlyLockMessage(profile)).toEqual({ key: 'prompt.lock.openElsewhere', values: {}, parts: { profile } });
  });

  it('readOnlyLockMessage_perfilDesconocido_sePintaEnCastellano', () => {
    const message = readOnlyLockMessage(localized('prompt.lock.unknownProfile'));

    expect(renderLocalized(createTranslator('es'), message)).toBe('Abierta en otra instancia de Mage (perfil desconocido)');
  });
});
