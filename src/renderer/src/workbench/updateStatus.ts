import { renderLocalized } from '@shared/i18n/localizedText';
import type { UpdateState } from '@shared/update';
import { t } from '../i18n/uiLanguage';

// Texto del estado de la actualizacion en Configuración (F1.3, #15). La barra de estado solo enseña
// `ready`; aqui se ve cada paso de «Buscar actualizaciones». Sin IPC; el texto sale del catalogo del idioma activo
// en el momento de pintar.
export function updateStatusText(state: UpdateState): string {
  switch (state.kind) {
    case 'idle':
      return t('settings.update.status.idle');
    case 'checking':
      return t('settings.update.status.checking');
    case 'upToDate':
      return t('settings.update.status.upToDate', { version: state.version });
    case 'error':
      return t('settings.update.status.error', { message: renderLocalized(t, state.message) });
    case 'downloading':
      return t('settings.update.status.downloading', { version: state.version });
    case 'ready':
      return t('settings.update.status.ready', { version: state.version });
  }
}

// Mientras busca o descarga, el botón no lanza otra consulta (main tampoco la duplicaría).
export function canCheckForUpdates(state: UpdateState): boolean {
  return state.kind !== 'checking' && state.kind !== 'downloading';
}
