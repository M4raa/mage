import { useEffect, useRef, useState } from 'react';
import type { McpExtensionInstallPreview, McpExtensionView, McpUserConfigField, McpUserConfigValue } from '@shared/mcp';
import { useMcpStore } from '../../mcpStore';
import { Icon } from '../Icon';
import { McpScopeDialog, ProviderPills } from './McpScopeDialog';
import { MCP_BUTTON_CLASS as BUTTON_CLASS, MCP_DIALOG_PANEL_CLASS, MCP_DIALOG_SCRIM_CLASS, MCP_PRIMARY_BUTTON_CLASS, stopEscape } from './mcpStyles';
import { useT } from '../../../i18n/uiLanguage';

// Pestaña «Extensiones» (C3-a…d): paquetes .mcpb/.dxt de Mage. Instalar desde archivo (el dialogo lo
// abre main y el usuario confirma viendo autor y version), importar de Claude Desktop COPIANDO,
// activar, «Solo en…», ajustes de user_config (los sensibles van a la boveda de main y nunca vuelven) y
// desinstalar.

const INPUT_CLASS =
  'w-full min-w-0 rounded-[5px] border border-mg-border-subtle bg-mg-panel px-[7px] py-[3px] font-mono text-[11px] text-mg-body outline-none focus:border-mg-border-emph';

const BYTES_PER_KB = 1024;

// Campos de ruta: el dialogo nativo lo abre main.
const PATH_PICKERS: Partial<Record<McpUserConfigField['type'], () => Promise<string | null>>> = {
  directory: () => window.mage.pickDirectory(),
  file: () => window.mage.pickMcpFile(),
};

type Dialog =
  | { readonly kind: 'none' }
  | { readonly kind: 'install'; readonly preview: McpExtensionInstallPreview }
  | { readonly kind: 'config'; readonly extension: McpExtensionView }
  | { readonly kind: 'scope'; readonly extension: McpExtensionView };

export function McpExtensionsTab(): React.JSX.Element {
  const list = useMcpStore((s) => s.extensions);
  const loadError = useMcpStore((s) => s.extensionsError);
  const run = useMcpStore((s) => s.runExtensionAction);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const attempt = (action: () => Promise<unknown>): void => {
    setError(null);
    run(action).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const pick = (): void => {
    setError(null);
    window.mage
      .pickMcpExtension()
      .then((preview) => preview !== null && setDialog({ kind: 'install', preview }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const close = (): void => setDialog({ kind: 'none' });
  return (
    <div className="flex flex-col gap-[10px]" data-mcp-extensions="true">
      <div role="note" className="rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[7px_10px] text-[10.5px] text-mg-warn-text">
        {t('mcp.extensions.warning')}
      </div>
      <div className="flex items-center gap-[8px]">
        <span className="flex-1 text-[10.5px] text-mg-sec">{t('mcp.extensions.loadedIn')}</span>
        <button onClick={pick} className={BUTTON_CLASS}>
          <Icon name="import" />
          {t('mcp.extensions.installFromFile')}
        </button>
      </div>
      {(error ?? loadError) !== null && (
        <div role="alert" className="text-[10.5px] text-mg-danger">
          {error ?? loadError}
        </div>
      )}
      {(list?.warnings ?? []).map((warning) => (
        <div key={warning} role="status" className="text-[10px] text-mg-warn-text">
          {warning}
        </div>
      ))}
      {list === null && <p className="text-[11px] text-mg-muted">{t('mcp.common.loading')}</p>}
      {list !== null && list.extensions.length === 0 && <p className="text-[11px] text-mg-muted">{t('mcp.extensions.empty')}</p>}
      {list !== null &&
        list.extensions.map((extension) => (
          <ExtensionCard
            key={extension.id}
            extension={extension}
            onToggle={() => attempt(() => window.mage.setMcpExtensionEnabled(extension.id, !extension.enabled))}
            onConfig={() => setDialog({ kind: 'config', extension })}
            onScope={() => setDialog({ kind: 'scope', extension })}
            onRemove={() => attempt(() => window.mage.removeMcpExtension(extension.id))}
          />
        ))}
      <DesktopImport onImport={(dirName) => attempt(() => window.mage.importDesktopMcpExtension(dirName))} />
      {dialog.kind === 'install' && <InstallDialog preview={dialog.preview} onClose={close} onError={setError} />}
      {dialog.kind === 'config' && <ExtensionConfigDialog extension={dialog.extension} onClose={close} />}
      {dialog.kind === 'scope' && (
        <McpScopeDialog
          title={t('mcp.scope.dialogTitle', { name: dialog.extension.displayName })}
          scope={dialog.extension.onlyIn}
          onSave={(scope) => run(() => window.mage.setMcpExtensionOnlyIn(dialog.extension.id, scope))}
          onClose={close}
        />
      )}
    </div>
  );
}

function ExtensionCard({
  extension,
  onToggle,
  onConfig,
  onScope,
  onRemove,
}: {
  readonly extension: McpExtensionView;
  readonly onToggle: () => void;
  readonly onConfig: () => void;
  readonly onScope: () => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const t = useT();
  return (
    <div data-mcp-extension={extension.id} className="flex flex-col gap-[5px] rounded-[8px] border border-mg-border-subtle p-[9px_11px]">
      <div className="flex items-center gap-[8px]">
        <Icon name="puzzle" className="text-mg-focus" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-mg-body">
          {extension.displayName} <span className="font-normal text-mg-sec">{extension.version}</span>
        </span>
        <label className="flex items-center gap-[5px] text-[10.5px] text-mg-body2">
          <input type="checkbox" checked={extension.enabled} onChange={onToggle} aria-label={t('mcp.extensions.enableAria', { name: extension.displayName })} />
          {t('mcp.extensions.enabled')}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-[6px] text-[10px] text-mg-sec">
        {extension.author.length > 0 && <span>{t('mcp.extensions.byAuthor', { author: extension.author })}</span>}
        <span>{t('mcp.extensions.unsigned')}</span>
        <span>· {extension.serverType}</span>
        {extension.platforms.length > 0 && <span>· {extension.platforms.join(', ')}</span>}
        <ProviderPills providers={extension.enabled ? extension.providers : []} testId={extension.id} />
      </div>
      {extension.description.length > 0 && <p className="text-[10.5px] text-mg-body2">{extension.description}</p>}
      {extension.problem !== null && (
        <span role="status" data-mcp-extension-problem="true" className="text-[10.5px] text-mg-warn-text">
          {extension.problem}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-[4px]">
        {extension.fields.length > 0 && (
          <button onClick={onConfig} className={BUTTON_CLASS}>
            <Icon name="gear" />
            {t('mcp.extensions.settings')}
          </button>
        )}
        <button onClick={onScope} className={BUTTON_CLASS}>
          {t('mcp.extensions.scope')}
        </button>
        <button onClick={() => void window.mage.revealFile(extension.dir)} className={BUTTON_CLASS}>
          <Icon name="folderOpen" />
          {t('mcp.extensions.revealFolder')}
        </button>
        {confirmRemove ? (
          <button onClick={onRemove} className={`${BUTTON_CLASS} text-mg-danger`}>
            {t('mcp.extensions.confirmUninstall')}
          </button>
        ) : (
          <button onClick={() => setConfirmRemove(true)} className={BUTTON_CLASS} aria-label={t('mcp.extensions.uninstallAria', { name: extension.displayName })}>
            <Icon name="trash" />
            {t('mcp.extensions.uninstall')}
          </button>
        )}
      </div>
    </div>
  );
}

function DesktopImport({ onImport }: { readonly onImport: (dirName: string) => void }): React.JSX.Element | null {
  const candidates = useMcpStore((s) => s.extensions?.desktop ?? []);
  const t = useT();
  if (candidates.length === 0) return null;
  return (
    <div data-mcp-desktop-import="true" className="flex flex-col gap-[5px]">
      <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-mg-ter">{t('mcp.extensions.desktopImport.title')}</span>
      <span className="text-[10.5px] text-mg-sec">{t('mcp.extensions.desktopImport.hint')}</span>
      {candidates.map((candidate) => (
        <div key={candidate.dirName} data-mcp-desktop-candidate={candidate.dirName} className="flex items-center gap-[8px] text-[11px]">
          <span className="min-w-0 flex-1 text-mg-body">
            {candidate.displayName} <span className="text-mg-sec">{candidate.version}</span>
          </span>
          <button onClick={() => onImport(candidate.dirName)} className={BUTTON_CLASS}>
            {candidate.installed ? t('mcp.extensions.desktopImport.reimport') : t('mcp.extensions.desktopImport.import')}
          </button>
        </div>
      ))}
    </div>
  );
}

function InstallDialog({
  preview,
  onClose,
  onError,
}: {
  readonly preview: McpExtensionInstallPreview;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
}): React.JSX.Element {
  const run = useMcpStore((s) => s.runExtensionAction);
  const t = useT();
  const install = (): void => {
    run(() => window.mage.installMcpExtension(preview.token))
      .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))
      .finally(onClose);
  };
  return (
    <div className={MCP_DIALOG_SCRIM_CLASS} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('mcp.extensions.install.dialogAria')} data-mcp-install-dialog="true" onClick={(e) => e.stopPropagation()} onKeyDown={stopEscape(onClose)} className={MCP_DIALOG_PANEL_CLASS}>
        <div className="text-[12.5px] font-bold text-mg-text">
          {preview.replacesVersion === null
            ? t('mcp.extensions.install.titleInstall', { name: preview.displayName })
            : t('mcp.extensions.install.titleUpdate', { name: preview.displayName })}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-[10px] gap-y-[2px] text-[11px]">
          <dt className="text-mg-sec">{t('mcp.extensions.install.version')}</dt>
          <dd>{preview.replacesVersion === null ? preview.version : `${preview.replacesVersion} → ${preview.version}`}</dd>
          <dt className="text-mg-sec">{t('mcp.extensions.install.author')}</dt>
          <dd>{preview.author.length > 0 ? preview.author : t('mcp.extensions.install.authorMissing')}</dd>
          <dt className="text-mg-sec">{t('mcp.extensions.install.signature')}</dt>
          <dd>{t('mcp.extensions.install.signatureUnverified')}</dd>
          <dt className="text-mg-sec">{t('mcp.extensions.install.type')}</dt>
          <dd>{preview.serverType}</dd>
          <dt className="text-mg-sec">{t('mcp.extensions.install.contents')}</dt>
          <dd>{t('mcp.extensions.install.contentsValue', { files: preview.fileCount, kilobytes: Math.ceil(preview.unpackedBytes / BYTES_PER_KB) })}</dd>
        </dl>
        <p className="text-[10.5px] text-mg-warn-text">{t('mcp.extensions.install.warning')}</p>
        <div className="flex justify-end gap-[8px]">
          <button onClick={onClose} className={BUTTON_CLASS}>
            {t('mcp.common.cancel')}
          </button>
          <button onClick={install} className={MCP_PRIMARY_BUTTON_CLASS}>
            {preview.replacesVersion === null ? t('mcp.extensions.install.install') : t('mcp.extensions.install.update')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Formulario de user_config. Solo se envia lo que el usuario toca: un sensible sin tocar no viaja (se
// conserva en la boveda); vaciarlo y guardar lo borra.
function ExtensionConfigDialog({ extension, onClose }: { readonly extension: McpExtensionView; readonly onClose: () => void }): React.JSX.Element {
  const run = useMcpStore((s) => s.runExtensionAction);
  const [values, setValues] = useState<Readonly<Record<string, McpUserConfigValue>>>({});
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLDivElement | null>(null);
  const t = useT();
  useEffect(() => first.current?.querySelector<HTMLElement>('input, button')?.focus(), []);
  const change = (key: string, value: McpUserConfigValue): void => setValues((current) => ({ ...current, [key]: value }));
  const save = (): void => {
    setError(null);
    run(() => window.mage.saveMcpExtensionConfig({ id: extension.id, values }))
      .then(onClose)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className={MCP_DIALOG_SCRIM_CLASS} onClick={onClose}>
      <div
        ref={first}
        role="dialog"
        aria-modal="true"
        aria-label={t('mcp.extensions.config.title', { name: extension.displayName })}
        data-mcp-extension-config="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={stopEscape(onClose)}
        className={MCP_DIALOG_PANEL_CLASS}
      >
        <div className="text-[12.5px] font-bold text-mg-text">{t('mcp.extensions.config.title', { name: extension.displayName })}</div>
        {extension.fields.map((field) => (
          <ConfigField key={field.key} field={field} value={values[field.key]} onChange={(value) => change(field.key, value)} />
        ))}
        {error !== null && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-[8px]">
          <button onClick={onClose} className={BUTTON_CLASS}>
            {t('mcp.common.cancel')}
          </button>
          <button onClick={save} className={MCP_PRIMARY_BUTTON_CLASS}>
            {t('mcp.common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  readonly field: McpUserConfigField;
  readonly value: McpUserConfigValue | undefined;
  readonly onChange: (value: McpUserConfigValue) => void;
}): React.JSX.Element {
  const current = value === undefined ? field.value : value;
  const label = `${field.title}${field.required ? ' *' : ''}`;
  return (
    <label className="flex flex-col gap-[3px]" data-mcp-config-field={field.key}>
      <span className="text-[9.5px] uppercase tracking-[.06em] text-mg-ter">{label}</span>
      <FieldInput field={field} current={current} touched={value !== undefined} onChange={onChange} />
      {field.description.length > 0 && <span className="text-[10px] text-mg-sec">{field.description}</span>}
    </label>
  );
}

function FieldInput({
  field,
  current,
  touched,
  onChange,
}: {
  readonly field: McpUserConfigField;
  readonly current: McpUserConfigValue;
  readonly touched: boolean;
  readonly onChange: (value: McpUserConfigValue) => void;
}): React.JSX.Element {
  const t = useT();
  if (field.type === 'boolean') return <input type="checkbox" checked={current === true} onChange={(e) => onChange(e.target.checked)} aria-label={field.title} />;
  if (field.sensitive) {
    return (
      <input
        type="password"
        autoComplete="off"
        value={touched && typeof current === 'string' ? current : ''}
        placeholder={field.hasValue ? t('mcp.common.maskedPlaceholder') : ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.title}
        className={INPUT_CLASS}
      />
    );
  }
  if (field.multiple) {
    const text = Array.isArray(current) ? current.join('\n') : '';
    return <textarea value={text} rows={3} onChange={(e) => onChange(e.target.value.split('\n').filter((line) => line.trim().length > 0))} aria-label={field.title} className={`${INPUT_CLASS} resize-y`} />;
  }
  const text = current === null || Array.isArray(current) ? '' : String(current);
  const parse = (raw: string): McpUserConfigValue => {
    if (field.type !== 'number') return raw;
    return raw.trim().length === 0 ? null : Number(raw);
  };
  const pickPath = PATH_PICKERS[field.type] ?? null;
  return (
    <span className="flex gap-[6px]">
      <input type={field.type === 'number' ? 'number' : 'text'} value={text} onChange={(e) => onChange(parse(e.target.value))} aria-label={field.title} className={INPUT_CLASS} />
      {pickPath !== null && (
        <button type="button" onClick={() => void pickPath().then((path) => path !== null && onChange(path))} className={BUTTON_CLASS}>
          {t('mcp.extensions.config.pick')}
        </button>
      )}
    </span>
  );
}
