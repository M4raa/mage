import type { AboutInfo } from '@shared/ipc';
import { renderLocalized } from '@shared/i18n/localizedText';
import type { Translate } from '@shared/i18n/translator';

// El texto del recuadro de avisos de terceros de «Acerca de»: los avisos de main (frase de Mage si falta el fichero, o su
// contenido tal cual), «cargando…» mientras no llegan, o nada si la carga falló (el error se enseña aparte).
export function aboutNoticesText(about: AboutInfo | null, error: string | null, t: Translate): string {
  if (about !== null) return renderLocalized(t, about.notices);
  if (error !== null) return '';
  return t('settings.about.noticesLoading');
}
