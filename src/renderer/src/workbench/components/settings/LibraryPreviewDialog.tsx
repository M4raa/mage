import { useEffect, useRef, useState } from 'react';
import type { LibraryAccountView, LibraryComponentView, LibraryEntryView, LibraryPreviewView } from '@shared/ipc';
import { useT } from '../../../i18n/uiLanguage';
import { formatInteger } from '../../../i18n/format';
import { describeError } from '../../describeError';
import { blockKey, componentKey } from './libraryModel';
import { MCP_BUTTON_CLASS, MCP_DIALOG_PANEL_CLASS, MCP_DIALOG_SCRIM_CLASS, MCP_PRIMARY_BUTTON_CLASS, stopEscape } from './mcpStyles';

// Vista previa de una instalación (P-U8): lo que se escribiría y lo que se ejecutaría, ANTES de instalar.
// El botón «Instalar» vive solo aquí. Pedir la vista previa no escribe ni ejecuta nada.

const LIST_SEPARATOR = ', ';

interface Props {
  readonly entry: LibraryEntryView;
  readonly account: LibraryAccountView;
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onClose: () => void;
}

type PreviewState = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly preview: LibraryPreviewView } | { readonly kind: 'error'; readonly text: string };

export function LibraryPreviewDialog({ entry, account, busy, onInstall, onClose }: Props): React.JSX.Element {
  const t = useT();
  const panel = useRef<HTMLDivElement | null>(null);
  const state = usePreview(entry, account);
  const preview = state.kind === 'ready' ? state.preview : null;
  useEffect(() => panel.current?.focus(), []);
  const title = t('library.preview.title', { title: entry.title, account: account.label });
  return (
    <div className={MCP_DIALOG_SCRIM_CLASS} onClick={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-library-preview={entry.id}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={stopEscape(onClose)}
        className={MCP_DIALOG_PANEL_CLASS}
      >
        <div className="text-[12.5px] font-bold text-mg-text">{title}</div>
        {state.kind === 'error' && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {state.text}
          </div>
        )}
        {preview !== null && <PreviewBody preview={preview} />}
        <div className="flex justify-end gap-[8px]">
          <button onClick={onClose} className={MCP_BUTTON_CLASS}>
            {t('library.action.cancel')}
          </button>
          <button
            onClick={onInstall}
            disabled={preview === null || preview.block !== null || busy}
            data-library-action="install"
            className={MCP_PRIMARY_BUTTON_CLASS}
          >
            {t('library.action.install')}
          </button>
        </div>
      </div>
    </div>
  );
}

function usePreview(entry: LibraryEntryView, account: LibraryAccountView): PreviewState {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    window.mage
      .libraryPreview({ packageId: entry.id, engine: account.engine, accountDir: account.accountDir })
      .then((preview) => alive && setState({ kind: 'ready', preview }))
      .catch((err: unknown) => alive && setState({ kind: 'error', text: describeError(err) }));
    return () => {
      alive = false;
    };
  }, [entry.id, account.engine, account.accountDir]);
  return state;
}

function PreviewBody({ preview }: { readonly preview: LibraryPreviewView }): React.JSX.Element {
  const t = useT();
  return (
    <>
      {preview.block !== null && (
        <p role="status" className="text-[11px] text-mg-warn-text">
          {t('library.preview.blocked', { reason: t(blockKey(preview.block)) })}
        </p>
      )}
      {preview.files.length > 0 && <PreviewFiles files={preview.files} />}
      {preview.commands.length > 0 && <PreviewCommands preview={preview} />}
      <PreviewSection title={t('library.preview.components')}>
        {preview.components.map((component) => (
          <li key={`${component.engine}:${component.kind}`}>{describeComponent(component)}</li>
        ))}
      </PreviewSection>
      {preview.runsCode && <p className="text-[10.5px] text-mg-warn-text">{t('library.runsCode')}</p>}
      <p className="text-[10px] text-mg-sec">{t('library.preview.nothingRun')}</p>
    </>
  );

  function describeComponent(component: LibraryPreviewView['components'][number]): string {
    return t(componentKey(component.kind), { count: component.count ?? component.names.length, names: component.names.join(LIST_SEPARATOR) });
  }
}

function PreviewFiles({ files }: { readonly files: LibraryPreviewView['files'] }): React.JSX.Element {
  const t = useT();
  return (
    <PreviewSection title={t('library.preview.files')}>
      {files.map((file) => (
        <li key={file.absPath} data-library-preview-file={file.absPath} className="break-all font-mono text-[10.5px]">
          {t('library.preview.fileLine', { path: file.absPath, bytes: formatInteger(file.bytes) })}
        </li>
      ))}
    </PreviewSection>
  );
}

function PreviewCommands({ preview }: { readonly preview: LibraryPreviewView }): React.JSX.Element {
  const t = useT();
  return (
    <PreviewSection title={t('library.preview.commands')}>
      <li className="break-all text-[10.5px] text-mg-sec">{t('library.preview.env', { name: preview.envVar, value: preview.accountDir })}</li>
      {preview.commands.map((command) => (
        <li key={command}>
          <code data-library-preview-command className="break-all font-mono text-[10.5px]">
            {command}
          </code>
        </li>
      ))}
    </PreviewSection>
  );
}

function PreviewSection({ title, children }: { readonly title: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-[3px]">
      <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-mg-ter">{title}</span>
      <ul className="flex flex-col gap-[2px] text-[11px] text-mg-body">{children}</ul>
    </section>
  );
}
