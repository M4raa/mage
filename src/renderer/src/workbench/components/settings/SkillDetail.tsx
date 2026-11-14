import { useEffect, useState } from 'react';
import type { SkillFileView } from '@shared/capabilities';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import type { Translate } from '@shared/i18n/translator';
import { useT } from '../../../i18n/uiLanguage';
import { describeError } from '../../describeError';
import { parseFrontmatter } from '../../memoryView';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon } from '../Icon';
import { Markdown } from '../Markdown';
import { TAB_ACTIVE, TAB_IDLE } from './CapabilityPage';
import { MCP_BUTTON_CLASS } from './mcpStyles';
import { MetaChip, RowMenu } from './McpRow';
import type { SkillEntry, SkillOriginKind } from './skillsModel';

// Detalle de una skill, como en Claude Desktop: cabecera con su origen y acciones, «Resumen» y «Contenido» (el SKILL.md con su
// cabecera en tabla y el cuerpo en Markdown). El fichero lo lee main (`capabilitiesSkillFile`); aquí solo se pinta.

const CHIP_KEYS = {
  user: 'capabilities.skills.detail.chip.user',
  project: 'capabilities.skills.detail.chip.project',
  plugin: 'capabilities.skills.detail.chip.plugin',
  organization: 'capabilities.skills.detail.chip.organization',
} as const satisfies Record<SkillOriginKind, MessageKey>;
const BY_KEYS = {
  user: 'capabilities.skills.detail.by.user',
  project: 'capabilities.skills.detail.by.project',
  organization: 'capabilities.skills.detail.by.organization',
} as const satisfies Record<Exclude<SkillOriginKind, 'plugin'>, MessageKey>;
const BYTES_PER_KB = 1024;

type DetailTab = 'summary' | 'content';
type FileLoad = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly file: SkillFileView } | { readonly kind: 'error'; readonly message: string };

export interface SkillDetailProps {
  readonly entry: SkillEntry;
  readonly accountDir: string;
  readonly originText: string;
  readonly onBack: () => void;
}

function useSkillFile(accountDir: string, entry: SkillEntry): FileLoad {
  const [load, setLoad] = useState<FileLoad>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    window.mage
      .capabilitiesSkillFile({ accountDir, name: entry.name, origin: entry.origin })
      .then((file) => alive && setLoad({ kind: 'ready', file }))
      .catch((err: unknown) => alive && setLoad({ kind: 'error', message: describeError(err) }));
    return () => {
      alive = false;
    };
  }, [accountDir, entry.name, entry.origin]);
  return load;
}

function bylineOf(t: Translate, entry: SkillEntry): string {
  if (entry.origin === 'plugin') return `${t('capabilities.skills.detail.by.plugin', { plugin: entry.plugin ?? entry.name })} · /${entry.name}`;
  return `${t(BY_KEYS[entry.origin])} · /${entry.name}`;
}

function pathOf(load: FileLoad): string | null {
  return load.kind === 'ready' && load.file.state !== 'missing' ? load.file.path : null;
}

export function SkillDetail({ entry, accountDir, originText, onBack }: SkillDetailProps): React.JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<DetailTab>('summary');
  const load = useSkillFile(accountDir, entry);
  return (
    <div data-skill-detail={entry.name} className="flex flex-col gap-[12px]">
      <button type="button" data-skill-detail-back="true" onClick={onBack} className="self-start text-[11px] text-mg-icon hover:text-mg-body">
        {t('capabilities.skills.detail.back')}
      </button>
      <SkillDetailHeader entry={entry} accountDir={accountDir} path={pathOf(load)} />
      <DetailTabs tab={tab} onTab={setTab} />
      {tab === 'summary' ? <SkillSummary entry={entry} originText={originText} load={load} /> : <SkillContent load={load} />}
    </div>
  );
}

function SkillDetailHeader({ entry, accountDir, path }: { readonly entry: SkillEntry; readonly accountDir: string; readonly path: string | null }): React.JSX.Element {
  const t = useT();
  const tryCommand = useWorkbenchStore((s) => s.tryCommandInNewConversation);
  const warn = (what: string) => (err: unknown): void => console.warn(what, describeError(err));
  const copy = (): void => void navigator.clipboard.writeText(`/${entry.name}`).catch(warn('No se pudo copiar la skill:'));
  const reveal = (file: string): void => void window.mage.revealFile(file).catch(warn('No se pudo abrir la carpeta de la skill:'));
  const menu = [
    { label: t('capabilities.skills.copy', { name: entry.name }), onSelect: copy },
    ...(path === null ? [] : [{ label: t('capabilities.skills.detail.openFolder'), onSelect: () => reveal(path) }]),
  ];
  const tryIt = (): void => void tryCommand(accountDir, `/${entry.name}`).catch(warn('Probar en chat: no se pudo abrir la conversacion'));
  return (
    <header className="flex items-start gap-[10px]">
      <span className="grid h-[32px] w-[32px] flex-none place-items-center rounded-[7px] bg-mg-hover text-mg-sec"><Icon name="brain" size={16} /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
          <h3 className="truncate text-[14px] font-semibold text-mg-text">{entry.name}</h3>
          <MetaChip>{t(CHIP_KEYS[entry.origin])}</MetaChip>
        </div>
        <p data-skill-byline="true" className="truncate text-[11px] text-mg-ter">{bylineOf(t, entry)}</p>
      </div>
      <button type="button" data-skill-try="true" onClick={tryIt} className={MCP_BUTTON_CLASS}>{t('capabilities.skills.detail.try')}</button>
      <RowMenu label={t('capabilities.row.menuAria', { name: entry.name })} items={menu} />
    </header>
  );
}

function DetailTabs({ tab, onTab }: { readonly tab: DetailTab; readonly onTab: (tab: DetailTab) => void }): React.JSX.Element {
  const t = useT();
  const item = (id: DetailTab, label: string): React.JSX.Element => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} data-skill-detail-tab={id} onClick={() => onTab(id)} className={tab === id ? TAB_ACTIVE : TAB_IDLE}>
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label={t('capabilities.skills.detail.tabsAria')} className="flex items-center gap-[4px]">
      {item('summary', t('capabilities.skills.detail.tabs.summary'))}
      {item('content', t('capabilities.skills.detail.tabs.content'))}
    </div>
  );
}

function locationText(t: Translate, load: FileLoad): string {
  if (load.kind === 'loading') return t('mcp.common.loading');
  if (load.kind === 'error') return t('capabilities.loadError', { error: load.message });
  return load.file.state === 'missing' ? t('capabilities.skills.detail.notFound') : load.file.path;
}

function SkillSummary({ entry, originText, load }: { readonly entry: SkillEntry; readonly originText: string; readonly load: FileLoad }): React.JSX.Element {
  const t = useT();
  const rows: (readonly [string, string, string])[] = [
    ['description', t('capabilities.skills.detail.field.description'), entry.description === '' ? t('capabilities.skills.detail.noDescription') : entry.description],
    ['origin', t('capabilities.skills.detail.field.origin'), originText],
    ['location', t('capabilities.skills.detail.field.location'), locationText(t, load)],
  ];
  if (entry.plugin !== null) rows.push(['plugin', t('capabilities.skills.detail.field.plugin'), entry.plugin]);
  if (entry.marketplace !== null) rows.push(['marketplace', t('capabilities.skills.detail.field.marketplace'), entry.marketplace]);
  return (
    <dl data-skill-summary="true" className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-[12px] gap-y-[8px] text-[11px]">
      {rows.map(([id, label, value]) => (
        <div key={id} data-skill-field={id} className="contents">
          <dt className="text-mg-ter">{label}</dt>
          <dd className="min-w-0 break-words text-mg-body">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SkillContent({ load }: { readonly load: FileLoad }): React.JSX.Element {
  const t = useT();
  const message = 'text-[11px] text-mg-muted';
  if (load.kind === 'loading') return <p data-skill-content="loading" className={message}>{t('mcp.common.loading')}</p>;
  if (load.kind === 'error') return <p role="alert" data-skill-content="error" className="text-[11px] text-mg-danger">{t('capabilities.loadError', { error: load.message })}</p>;
  const file = load.file;
  if (file.state === 'missing') return <p data-skill-content="missing" className={message}>{t('capabilities.skills.detail.missing')}</p>;
  if (file.state === 'too_large') return <p data-skill-content="too_large" className={message}>{t('capabilities.skills.detail.tooLarge', { kb: Math.ceil(file.sizeBytes / BYTES_PER_KB) })}</p>;
  const { attributes, body } = parseFrontmatter(file.content);
  return (
    <div data-skill-content="ok" className="flex flex-col gap-[12px]">
      <FrontmatterTable attributes={attributes} />
      <Markdown text={body} />
    </div>
  );
}

// La cabecera del SKILL.md como tabla clave/valor (solo los valores de una línea; `parseFrontmatter` aplana un nivel).
function FrontmatterTable({ attributes }: { readonly attributes: Readonly<Record<string, string>> }): React.JSX.Element | null {
  const t = useT();
  const entries = Object.entries(attributes);
  if (entries.length === 0) return null;
  return (
    <table data-skill-frontmatter="true" aria-label={t('capabilities.skills.detail.frontmatterAria')} className="w-full border-collapse text-[10.5px]">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} data-frontmatter-key={key} className="border-b border-mg-border-subtle">
            <th scope="row" className="w-[140px] py-[3px] pr-[10px] text-left align-top font-mono font-normal text-mg-ter">{key}</th>
            <td className="break-words py-[3px] text-mg-body">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
