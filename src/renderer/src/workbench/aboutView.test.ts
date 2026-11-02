import { describe, expect, it } from 'vitest';
import { foreignText, localized } from '@shared/i18n/localizedText';
import type { AboutInfo } from '@shared/ipc';
import { createTranslator } from '@shared/i18n/translator';
import { aboutNoticesText } from './aboutView';

const t = createTranslator('es');
const VERSIONS = { app: '0.1.3', electron: '1', chromium: '1', node: '1' };

function about(notices: AboutInfo['notices']): AboutInfo {
  return { versions: VERSIONS, notices, chromiumLicensesPath: null };
}

describe('aboutNoticesText', () => {
  it('aboutNoticesText_ficheroAusente_pintaLaFraseEnCastellano', () => {
    const info = about(localized('settings.about.noticesMissing', { file: 'THIRD-PARTY-NOTICES.txt' }));

    expect(aboutNoticesText(info, null, t)).toBe('No se encontró THIRD-PARTY-NOTICES.txt en esta instalación. Se genera con `pnpm notices` y debe viajar con la aplicación.');
  });

  it('aboutNoticesText_contenidoDelFichero_loDejaTalCual', () => {
    expect(aboutNoticesText(about(foreignText('AVISOS {x} \'y\'')), null, t)).toBe('AVISOS {x} \'y\'');
  });

  it('aboutNoticesText_sinDatosNiError_cargando', () => {
    expect(aboutNoticesText(null, null, t)).toBe(t('settings.about.noticesLoading'));
  });

  it('aboutNoticesText_sinDatosYConError_vacio', () => {
    expect(aboutNoticesText(null, 'fallo', t)).toBe('');
  });
});
