import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import type { ArtifactCard as ArtifactCardModel } from '../artifactView';

// Tarjeta de un artifact publicado (2.4). Lo que resuelve, y que un navegador no puede: abrirlo con la
// MISMA cuenta que lo publico, aunque la conversacion se este mirando con otra.
//
// Por eso el boton principal solo dice "Abrir" cuando se SABE quien lo publico (esta en el indice de
// Mage). Si no consta —publicado fuera de Mage, o antes de esta version— se ofrece "Abrir con…" y lo
// elige el usuario: abrirlo con una cuenta arbitraria es justo el fallo que este punto viene a
// arreglar.
export function ArtifactCard({ card }: { readonly card: ArtifactCardModel }): React.JSX.Element {
  const accounts = useWorkbenchStore((s) => s.accounts);
  const [publisher, setPublisher] = useState<string | null | undefined>(undefined); // undefined = aun no se sabe
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.mage
      .lookupArtifactPublisher(card.url)
      .then((accountDir) => {
        if (!cancelled) setPublisher(accountDir);
      })
      .catch(() => {
        if (!cancelled) setPublisher(null); // sin indice se ofrece elegir cuenta, nunca abrir a ciegas
      });
    return () => {
      cancelled = true;
    };
  }, [card.url]);

  const open = (accountDir?: string): void => {
    setError(null);
    setPickerOpen(false);
    void window.mage
      .openArtifact(accountDir === undefined ? { url: card.url } : { url: card.url, accountDir })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const copy = (): void => {
    void navigator.clipboard
      .writeText(card.url)
      .then(() => setCopied(true))
      .catch(() => setError('No se pudo copiar el enlace'));
  };

  const knownPublisher = typeof publisher === 'string' && publisher.length > 0;
  const publisherAlias = accounts.find((account) => account.id === publisher)?.alias ?? publisher;

  return (
    <div className="flex justify-start">
      <div className="flex min-w-0 max-w-[92%] flex-col gap-[8px] rounded-[10px] border border-mg-border-emph bg-mg-block p-[11px_13px]">
        <div className="flex items-start gap-[9px]">
          <span data-artifact-favicon aria-hidden="true" className="text-[16px] leading-none">{card.favicon.length > 0 ? card.favicon : <Icon name="file" size={15} />}</span>
          <div className="flex min-w-0 flex-col gap-[2px]">
            <span className="truncate text-[12px] font-bold text-mg-text">{card.title}</span>
            {card.description.length > 0 && (
              // `break-words`: la descripcion la escribe el modelo y puede venir sin un solo espacio
              // (una ruta larga, una URL). Sin esto, esa palabra unica ensancha la tarjeta y saca
              // scroll horizontal al hilo — cazado midiendo `scrollWidth` con una de 300 caracteres.
              <span className="break-words text-[11px] leading-[1.45] text-mg-sec2">{card.description}</span>
            )}
            <span className="truncate font-mono text-[10px] text-mg-muted" title={card.url}>
              {card.url}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[6px] text-[11px]">
          {knownPublisher ? (
            <button
              onClick={() => open()}
              data-tip={`Se abrirá con la cuenta ${publisherAlias}`}
              aria-label={`Abrir el artifact ${card.title}`}
              className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-mg-body2 hover:bg-mg-hover"
            >
              Abrir con {publisherAlias}
            </button>
          ) : (
            <button
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
              aria-label={`Abrir con… el artifact ${card.title}`}
              className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-mg-body2 hover:bg-mg-hover"
            >
              Abrir con…
            </button>
          )}
          <button onClick={copy} className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-mg-body2 hover:bg-mg-hover">
            {copied ? '✓ Copiado' : 'Copiar enlace'}
          </button>
          {card.localPath.length > 0 && (
            <button
              onClick={() => void window.mage.openPath(card.localPath).catch(() => setError('No se pudo abrir el fichero local'))}
              className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-mg-body2 hover:bg-mg-hover"
            >
              Abrir el fichero local
            </button>
          )}
        </div>

        {pickerOpen && (
          <div role="group" aria-label="Elegir cuenta con la que abrir" className="flex flex-wrap gap-[6px]">
            {accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => open(account.id)}
                className="rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
                style={{ borderColor: account.accent.borderInactive }}
              >
                {account.alias}
              </button>
            ))}
          </div>
        )}

        {error !== null && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
