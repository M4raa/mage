import { useCopyToClipboard } from '../useCopyToClipboard';
import { Icon } from './Icon';
import { useT } from '../../i18n/uiLanguage';
import type { Translate } from '@shared/i18n/translator';

function buttonText(t: Translate, copied: boolean, failed: boolean): string {
  if (failed) return t('chat.copy.error');
  return copied ? t('chat.copy.copied') : t('chat.copy.copy');
}

// Boton «Copiar» del chat: icono + «Copiar» -> «Copiado». El error se ve (title + rojo), no se traga.
// `text` es el markdown CRUDO. `className` posiciona el boton segun el contenedor.
export function CopyButton({
  text,
  label,
  className = '',
}: {
  readonly text: string;
  readonly label: string;
  readonly className?: string;
}): React.JSX.Element {
  const { copied, error, copy } = useCopyToClipboard();
  const t = useT();
  const shown = buttonText(t, copied, error !== null);
  const tone = error === null ? 'text-mg-muted hover:text-mg-body2' : 'text-mg-danger';
  return (
    <button
      type="button"
      data-copy-button="true"
      onClick={() => copy(text)}
      title={error ?? label}
      aria-label={error ?? (copied ? t('chat.copy.copied') : label)}
      className={`flex cursor-pointer items-center gap-[4px] rounded-[5px] px-[5px] py-[2px] text-[10.5px] hover:bg-mg-hover ${tone} ${className}`}
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
      <span>{shown}</span>
    </button>
  );
}
