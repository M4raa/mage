import { Fragment, useEffect, useRef, useState } from 'react';
import { LanguageControl } from './LanguageControl';
import { AvatarsPlacementControl, SeparatorContrastControl } from './AppearanceChoice';
import { canCheckForUpdates, updateStatusText } from '../updateStatus';
import type {
  CloseBehavior,
  ImportedTheme,
  NewConversationFolder,
  NotificationRule,
  ScratchRetention,
  ThemePreference,
} from '@shared/settings';
import { IMPORTED_CONTEXT_LIMITS, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from '@shared/settings';
import type { KeybindingOverride } from '@shared/settings';
import type { AboutInfo } from '@shared/ipc';
import { useWorkbenchStore } from '../workbenchStore';
import { usePanelLayoutStore } from '../panelLayoutStore';
import { HooksPermissionsSection } from './settings/HooksPermissionsSection';
import { KeepAliveSection } from './settings/KeepAliveSection';
import { LibrarySection } from './settings/LibrarySection';
import { McpServerSection } from './settings/McpServerSection';
import { McpSection } from './settings/McpSection';
import { ProvidersSection } from './settings/ProvidersSection';
import { ThemeMarketSection } from './settings/ThemeMarketSection';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { Icon, type IconName } from './Icon';
import { compileSafely } from '../notify';
import { KEYBINDING_ACTIONS, type KeybindingAction } from '../keybindings/actionCatalog';
import { findConflict } from '../keybindings/conflicts';
import { comboFromEvent, displayKeyCombo, formatKeyCombo, parseKeyCombo } from '../keybindings/keyParser';
import { isArrowNavKey, nextIndexForArrow } from '../a11y/keyboardNav';
import { isMacPlatform } from '../keybindings/platform';
import { changelogEntriesFor } from '../releaseNotesContent';
import { useT, useUiLanguageStore } from '../../i18n/uiLanguage';
import { aboutNoticesText } from '../aboutView';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import type { Translate } from '@shared/i18n/translator';
import { formatInteger } from '../../i18n/format';
import { describeError } from '../describeError';
import { useWidgetPrefs } from '../../widget/useWidgetPrefs';

// Secciones de Configuracion (crece por secciones). Cada una tiene su glifo+etiqueta en la nav y su
// titulo de cabecera.
type SectionKey =
  | 'notifications'
  | 'providers'
  | 'appearance'
  | 'widget'
  | 'mcp'
  | 'library'
  | 'hooksPermissions'
  | 'trustedFolders'
  | 'keybindings'
  | 'storage'
  | 'releaseNotes'
  | 'about';
// Grupos de la navegacion. NO se fusiona ni se mueve ninguna seccion: solo se agrupan, que es lo que
// convierte una lista plana de diez en algo escaneable. El orden de `SECTIONS` sigue siendo el orden
// de navegacion con flechas, asi que los grupos van seguidos.
// El grupo guarda la CLAVE de su titulo (ya en mayusculas en el catalogo) y se traduce al pintar.
type SectionGroup =
  | 'settings.groups.general'
  | 'settings.groups.appearance'
  | 'settings.groups.agents'
  | 'settings.groups.security'
  | 'settings.groups.about';

// `nav` y `title` son claves del catalogo: se traducen al pintar, nunca al importar.
const SECTIONS = [
  { key: 'notifications', group: 'settings.groups.general', icon: 'bell', nav: 'settings.sections.notifications.nav', title: 'settings.sections.notifications.title' },
  { key: 'storage', group: 'settings.groups.general', icon: 'broom', nav: 'settings.sections.storage.nav', title: 'settings.sections.storage.title' },
  { key: 'appearance', group: 'settings.groups.appearance', icon: 'palette', nav: 'settings.sections.appearance.nav', title: 'settings.sections.appearance.title' },
  { key: 'widget', group: 'settings.groups.appearance', icon: 'wand', nav: 'settings.sections.widget.nav', title: 'settings.sections.widget.title' },
  { key: 'keybindings', group: 'settings.groups.appearance', icon: 'keyboard', nav: 'settings.sections.keybindings.nav', title: 'settings.sections.keybindings.title' },
  { key: 'providers', group: 'settings.groups.agents', icon: 'plug', nav: 'settings.sections.providers.nav', title: 'settings.sections.providers.title' },
  { key: 'mcp', group: 'settings.groups.agents', icon: 'puzzle', nav: 'settings.sections.mcp.nav', title: 'settings.sections.mcp.title' },
  { key: 'library', group: 'settings.groups.agents', icon: 'import', nav: 'settings.sections.library.nav', title: 'settings.sections.library.title' },
  { key: 'hooksPermissions', group: 'settings.groups.security', icon: 'hook', nav: 'settings.sections.hooksPermissions.nav', title: 'settings.sections.hooksPermissions.title' },
  { key: 'trustedFolders', group: 'settings.groups.security', icon: 'shield', nav: 'settings.sections.trustedFolders.nav', title: 'settings.sections.trustedFolders.title' },
  // «Acerca de» va la ULTIMA y en su propio grupo: no es un ajuste, es donde viven los avisos de
  // terceros (B.2 de la revision de licencias de terceros — las 85 dependencias exigen conservar su copyright y el
  // bundle los borra, asi que este es el sitio donde la app los enseña).
  { key: 'releaseNotes', group: 'settings.groups.about', icon: 'sparkles', nav: 'settings.sections.releaseNotes.nav', title: 'settings.sections.releaseNotes.title' },
  { key: 'about', group: 'settings.groups.about', icon: 'info', nav: 'settings.sections.about.nav', title: 'settings.sections.about.title' },
] as const satisfies readonly {
  readonly key: SectionKey;
  readonly group: SectionGroup;
  readonly icon: IconName;
  readonly nav: MessageKey;
  readonly title: MessageKey;
}[];

// Pantalla de Configuracion de la app (M2.3+). Puerta: solo monta el dialogo cuando esta abierto (asi
// el hook de accesibilidad —foco/Escape/trap— se inicializa en cada apertura).
export function SettingsView(): React.JSX.Element | null {
  const open = useWorkbenchStore((s) => s.settingsOpen);
  if (!open) return null;
  return <SettingsDialog />;
}

// Overlay a pantalla completa con navegacion de secciones a la izquierda. Cada cambio se guarda al
// instante (persistencia con debounce en el store).
function SettingsDialog(): React.JSX.Element {
  const t = useT();
  const closeSettings = useWorkbenchStore((s) => s.closeSettings);
  const rules = useWorkbenchStore((s) => s.settings.notificationRules);
  const saveNotificationRules = useWorkbenchStore((s) => s.saveNotificationRules);
  const theme = useWorkbenchStore((s) => s.settings.theme);
  const setTheme = useWorkbenchStore((s) => s.setTheme);
  const backgroundOpacity = useWorkbenchStore((s) => s.settings.backgroundOpacity);
  const setBackgroundOpacity = useWorkbenchStore((s) => s.setBackgroundOpacity);
  const widgetEnabled = useWorkbenchStore((s) => s.settings.widgetEnabled);
  const setWidgetEnabled = useWorkbenchStore((s) => s.setWidgetEnabled);
  const importedThemes = useWorkbenchStore((s) => s.settings.importedThemes);
  const activeThemeId = useWorkbenchStore((s) => s.settings.activeThemeId);
  const applyImportedTheme = useWorkbenchStore((s) => s.applyImportedTheme);
  const selectImportedTheme = useWorkbenchStore((s) => s.selectImportedTheme);
  const removeImportedTheme = useWorkbenchStore((s) => s.removeImportedTheme);
  const keybindingOverrides = useWorkbenchStore((s) => s.settings.keybindingOverrides);
  const setKeybindingOverride = useWorkbenchStore((s) => s.setKeybindingOverride);
  const resetAllKeybindings = useWorkbenchStore((s) => s.resetAllKeybindings);
  const scratchRetention = useWorkbenchStore((s) => s.settings.scratchRetention);
  const setScratchRetention = useWorkbenchStore((s) => s.setScratchRetention);
  const resetPanelLayout = usePanelLayoutStore((s) => s.resetLayout);
  const requestedSection = useWorkbenchStore((s) => s.settingsSection);
  const [section, setSection] = useState<SectionKey>(
    () => SECTIONS.find((s) => s.key === requestedSection)?.key ?? 'notifications',
  );
  const dialogRef = useDialogA11y({ onClose: closeSettings });
  const navRef = useRef<HTMLElement | null>(null);

  // El nav declara role="tablist", asi que DEBE responder a las flechas: un tablist que solo funciona
  // con raton incumple el patron ARIA. Mismo helper puro (a11y/keyboardNav) y mismo roving tabindex
  // que TabBar/Stripe/Dropdown; esta era la unica lista de pestañas del proyecto que se quedo sin el.
  const onNavKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (!isArrowNavKey(e.key)) return;
    e.preventDefault();
    const currentIndex = Math.max(0, SECTIONS.findIndex((s) => s.key === section));
    const nextIndex = nextIndexForArrow(SECTIONS.length, currentIndex, e.key);
    const next = SECTIONS[nextIndex];
    if (next === undefined) return;
    setSection(next.key);
    navRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
  };

  const current = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]!;
  // El dialogo es ELASTICO, no de tamaño fijo: los 720x70vh de antes dejaban la tienda de temas en
  // una rendija de dos columnas con miniaturas de 74 px. Crece con la ventana y se detiene donde una
  // linea de texto deja de ser comoda de leer.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={closeSettings}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(88vh,880px)] w-[min(94vw,1180px)] overflow-hidden rounded-[11px] border border-mg-border-pop bg-mg-panel text-[12px] mg-shadow-modal"
      >
        <nav
          ref={navRef}
          role="tablist"
          aria-orientation="vertical"
          onKeyDown={onNavKeyDown}
          className="flex w-[196px] shrink-0 flex-col gap-[1px] overflow-y-auto border-r border-mg-border bg-mg-rail p-[12px]"
        >
          <div id="settings-title" className="mb-[10px] flex items-center gap-[7px] text-[13px] font-bold text-mg-text">
            <Icon name="gear" size={15} />
            {t('settings.dialog.title')}
          </div>
          {SECTIONS.map((s, index) => (
            <Fragment key={s.key}>
              {(index === 0 || SECTIONS[index - 1]?.group !== s.group) && (
                <div className="mt-[10px] mb-[3px] px-[10px] text-[9.5px] font-bold tracking-[.1em] text-mg-ter first:mt-0">
                  {t(s.group)}
                </div>
              )}
              <button
                id={`settings-tab-${s.key}`}
                role="tab"
                aria-selected={s.key === section}
                aria-controls={`settings-panel-${s.key}`}
                tabIndex={s.key === section ? 0 : -1}
                onClick={() => setSection(s.key)}
                className={`flex items-center gap-[8px] rounded-[7px] px-[10px] py-[6px] text-left text-[11.5px] transition-colors duration-90 ease-out ${
                  s.key === section ? 'bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'text-mg-body2 hover:bg-mg-hover'
                }`}
              >
                <Icon name={s.icon} className={s.key === section ? 'text-mg-focus' : 'text-mg-ter'} />
                {t(s.nav)}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-mg-border p-[12px_16px]">
            <div className="text-[12.5px] font-semibold text-mg-text">{t(current.title)}</div>
            <button onClick={closeSettings} data-tip={t('settings.dialog.close')} aria-label={t('settings.dialog.closeAria')} className="text-[14px] text-mg-muted hover:text-mg-body">
              ✕
            </button>
          </div>
          <div
            role="tabpanel"
            id={`settings-panel-${current.key}`}
            aria-labelledby={`settings-tab-${current.key}`}
            tabIndex={0}
            className="flex min-h-0 flex-1 flex-col"
          >
            {section === 'notifications' && <NotificationRulesSection rules={rules} onChange={saveNotificationRules} />}
            {section === 'appearance' && (
              <AppearanceSection
                theme={theme}
                activeThemeId={activeThemeId}
                importedThemes={importedThemes}
                onChangeTheme={setTheme}
                onApplyImported={applyImportedTheme}
                onSelectImported={selectImportedTheme}
                onRemoveImported={removeImportedTheme}
                onResetPanelLayout={resetPanelLayout}
                backgroundOpacity={backgroundOpacity}
                onChangeBackgroundOpacity={setBackgroundOpacity}
              />
            )}
            {section === 'providers' && <ProvidersSection />}
            {section === 'widget' && <WidgetSection enabled={widgetEnabled} onChange={setWidgetEnabled} />}
            {section === 'mcp' && <McpSection />}
            {section === 'library' && <LibrarySection />}
            {section === 'hooksPermissions' && <HooksPermissionsSection />}
            {section === 'trustedFolders' && <TrustedFoldersSection />}
            {section === 'storage' && <StorageSection retention={scratchRetention} onChange={setScratchRetention} />}
            {section === 'releaseNotes' && <ReleaseNotesSection />}
            {section === 'about' && <AboutSection />}
            {section === 'keybindings' && (
              <KeybindingsSection
                overrides={keybindingOverrides}
                onSetOverride={setKeybindingOverride}
                onResetAll={resetAllKeybindings}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Opciones de tema (orden Sistema/Claro/Oscuro). El valor viaja tal cual a setTheme (ThemePreference).
// `label` y `hint` son claves: se traducen al pintar.
const THEME_OPTIONS = [
  { value: 'system', label: 'settings.appearance.theme.system', hint: 'settings.appearance.theme.systemHint' },
  { value: 'light', label: 'settings.appearance.theme.light', hint: 'settings.appearance.theme.lightHint' },
  { value: 'dark', label: 'settings.appearance.theme.dark', hint: 'settings.appearance.theme.darkHint' },
] as const satisfies readonly { readonly value: ThemePreference; readonly label: MessageKey; readonly hint: MessageKey }[];

// Seccion Apariencia: tema base (tarjetas) + temas importados de Open VSX. Todo se aplica al instante.
// Escala de la interfaz. Lee y escribe del store directamente en vez de viajar como dos props mas por
// `AppearanceSection`: es un control autonomo y el store ya es la fuente de verdad de los ajustes.
function UiScaleControl(): React.JSX.Element {
  const uiScale = useWorkbenchStore((s) => s.settings.uiScale);
  const setUiScale = useWorkbenchStore((s) => s.setUiScale);
  const t = useT();
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.appearance.uiScaleLabel')}</span>
      <div className="flex items-center gap-[12px]">
        <input
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          value={uiScale}
          onChange={(e) => setUiScale(Number(e.target.value))}
          aria-label={t('settings.appearance.uiScaleAria')}
          className="h-[4px] flex-1 cursor-pointer appearance-none rounded-full bg-mg-track accent-mg-fill"
        />
        <span data-setting="ui-scale" className="w-[42px] text-right font-mono text-[11px] tabular-nums text-mg-body2">
          {uiScale}%
        </span>
      </div>
      <span className="text-[10.5px] text-mg-muted">
        {t('settings.appearance.uiScaleHint', { min: UI_SCALE_MIN, max: UI_SCALE_MAX })}
      </span>
    </div>
  );
}

function AppearanceSection({
  theme,
  activeThemeId,
  importedThemes,
  onChangeTheme,
  onApplyImported,
  onSelectImported,
  onRemoveImported,
  onResetPanelLayout,
  backgroundOpacity,
  onChangeBackgroundOpacity,
}: {
  readonly theme: ThemePreference;
  readonly activeThemeId: string | null;
  readonly importedThemes: readonly ImportedTheme[];
  readonly onChangeTheme: (pref: ThemePreference) => void;
  readonly onApplyImported: (imported: ImportedTheme) => void;
  readonly onSelectImported: (id: string | null) => void;
  readonly onRemoveImported: (id: string) => void;
  readonly onResetPanelLayout: () => void;
  readonly backgroundOpacity: number;
  readonly onChangeBackgroundOpacity: (percent: number) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[14px_16px]">
      <LanguageControl />
      <UiScaleControl />
      <AvatarsPlacementControl />
      <SeparatorContrastControl />
      <div className="flex flex-col gap-[8px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.appearance.opacityLabel')}</span>
        <div className="flex items-center gap-[12px]">
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={backgroundOpacity}
            onChange={(e) => onChangeBackgroundOpacity(Number(e.target.value))}
            aria-label={t('settings.appearance.opacityAria')}
            className="h-[4px] flex-1 cursor-pointer appearance-none rounded-full bg-mg-track accent-mg-fill"
          />
          <span className="w-[42px] text-right font-mono text-[11px] tabular-nums text-mg-body2">{backgroundOpacity}%</span>
        </div>
        <span className="text-[10.5px] text-mg-muted">
          {t('settings.appearance.opacityHint')}
        </span>
      </div>
      <div className="flex flex-col gap-[8px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.appearance.baseThemeLabel')}</span>
        <div className="flex gap-[8px]">
          {THEME_OPTIONS.map((option) => {
            // Una tarjeta base solo esta "activa" si no hay tema importado activo.
            const selected = activeThemeId === null && option.value === theme;
            return (
              <button
                key={option.value}
                onClick={() => onChangeTheme(option.value)}
                data-tip={t(option.hint)}
                aria-pressed={selected}
                className={`flex-1 rounded-[8px] border px-[12px] py-[10px] text-left ${
                  selected ? 'border-mg-focus bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'border-mg-border-ctrl text-mg-body2 hover:bg-mg-hover'
                }`}
              >
                <div className="text-[12px] font-semibold">{t(option.label)}</div>
                <div className="mt-[3px] text-[10.5px] leading-[1.4] text-mg-ter">{t(option.hint)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <ThemeMarketSection
        activeThemeId={activeThemeId}
        importedThemes={importedThemes}
        backgroundOpacity={backgroundOpacity}
        onApplyImported={onApplyImported}
        onSelect={onSelectImported}
        onRemove={onRemoveImported}
      />

      <div className="flex flex-col gap-[8px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.appearance.panelLayoutLabel')}</span>
        <div className="flex items-center justify-between gap-[8px]">
          <p className="text-[10.5px] leading-[1.5] text-mg-sec">{t('settings.appearance.panelLayoutHint')}</p>
          <button
            onClick={onResetPanelLayout}
            className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[6px] text-[11px] text-mg-body2 hover:bg-mg-hover"
          >
            {t('settings.appearance.panelLayoutReset')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Seccion Widget flotante (M3): un unico interruptor que abre/cierra la ventana flotante always-on-top
// y persiste la preferencia (se reabre al arrancar si queda activa).
function WidgetSection({
  enabled,
  onChange,
}: {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
}): React.JSX.Element {
  const t = useT();
  const { prefs, update } = useWidgetPrefs(window.mage);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">{t('settings.widget.descriptionCompanion')}</p>
      <label className="flex items-center gap-[8px] text-[11.5px] text-mg-body">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
        {t('settings.widget.toggle')}
      </label>
      <label className="flex items-center gap-[8px] text-[11.5px] text-mg-body">
        <input
          type="checkbox"
          data-widget-settings-dnd
          checked={prefs?.doNotDisturb ?? false}
          disabled={prefs === null}
          onChange={(e) => update({ doNotDisturb: e.target.checked })}
        />
        {t('settings.widget.doNotDisturb')}
      </label>
      <p className="text-[10.5px] leading-[1.5] text-mg-muted">{t('settings.widget.doNotDisturbHint')}</p>
    </div>
  );
}

// Seccion "Almacenamiento" (auditoria B.4.2): cuanto se conservan las carpetas de trabajo de las
// conversaciones "sin friccion". Por defecto no se borra NADA; el resto son opt-in explicitos porque
// cada uno borra ficheros del disco del usuario.
// «Acerca de Mage» (B.2/B.3 de la revision de licencias de terceros). No es una pantalla de cortesia: es
// donde la app cumple lo que exigen las licencias de sus 85 dependencias —conservar el aviso de
// copyright al redistribuir—, porque el bundle minificado los borra. El texto viene de
// `THIRD-PARTY-NOTICES.txt` (generado con `pnpm notices`, empaquetado dentro del asar) y los de
// Chromium se abren desde su propio fichero, que instala Electron junto al ejecutable.
// Notas de version: el historial entero del changelog. Cada version abre la MISMA pestaña de novedades
// que sale sola al actualizar, ya en esa version; Configuracion se cierra para dejarla a la vista.
function ReleaseNotesSection(): React.JSX.Element {
  const closeSettings = useWorkbenchStore((s) => s.closeSettings);
  const openReleaseNotes = useWorkbenchStore((s) => s.openReleaseNotes);
  const installed = useWorkbenchStore((s) => s.appVersion);
  const t = useT();
  const entries = changelogEntriesFor(useUiLanguageStore((s) => s.resolved.language));
  const open = (version?: string): void => {
    closeSettings();
    openReleaseNotes(version);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">{t('settings.releaseNotes.description')}</p>
      <button
        onClick={() => open()}
        className="self-start rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-[11.5px] text-mg-body transition-colors duration-90 ease-out hover:bg-mg-hover"
      >
        {t('settings.releaseNotes.open')}
      </button>
      <UpdateCheck />
      <ul className="flex flex-col gap-[1px]" aria-label={t('settings.releaseNotes.versionsAria')}>
        {entries.map((entry) => (
          <li key={entry.version}>
            <button
              onClick={() => open(entry.version)}
              className="flex w-full items-baseline gap-[10px] rounded-[7px] px-[10px] py-[6px] text-left text-[11.5px] text-mg-body2 transition-colors duration-90 ease-out hover:bg-mg-hover"
            >
              <span className="font-mono text-mg-body">{entry.version}</span>
              <span className="text-mg-ter">{entry.label}</span>
              {entry.version === installed && <span className="text-[9.5px] text-mg-ter">{t('settings.releaseNotes.installed')}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// «Buscar actualizaciones» (F1.3, #15): consulta ya, aunque la automática sea reciente, y enseña cada
// estado. La versión lista se instala desde el mismo diálogo de siempre (UpdateReadyDialog).
function UpdateCheck(): React.JSX.Element {
  const state = useWorkbenchStore((s) => s.updateState);
  const checkForUpdates = useWorkbenchStore((s) => s.checkForUpdates);
  const closeSettings = useWorkbenchStore((s) => s.closeSettings);
  const openUpdatePrompt = useWorkbenchStore((s) => s.openUpdatePrompt);
  const t = useT();
  const showReady = (): void => {
    closeSettings();
    openUpdatePrompt();
  };
  return (
    <div data-update-check="true" className="flex flex-wrap items-center gap-[10px]">
      <button
        onClick={checkForUpdates}
        disabled={!canCheckForUpdates(state)}
        className="rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-[11.5px] text-mg-body transition-colors duration-90 ease-out hover:bg-mg-hover disabled:opacity-50"
      >
        {t('settings.update.check')}
      </button>
      {state.kind === 'ready' && (
        <button onClick={showReady} className="rounded-[7px] bg-mg-activity px-[12px] py-[6px] text-[11.5px] text-mg-window">
          {t('settings.update.viewAndRestart')}
        </button>
      )}
      <span role="status" className="min-w-0 text-[11px] text-mg-sec [overflow-wrap:anywhere]">
        {updateStatusText(state)}
      </span>
    </div>
  );
}

function AboutSection(): React.JSX.Element {
  const closeSettings = useWorkbenchStore((s) => s.closeSettings);
  const setOnboardingCompleted = useWorkbenchStore((s) => s.setOnboardingCompleted);
  const t = useT();
  // Cierra Configuracion ANTES de reabrir el asistente: si no, el asistente sale por encima del
  // dialogo que lo acaba de lanzar y al terminar se vuelve a ver Configuracion, que no es lo que pidio.
  const reopenOnboarding = (): void => {
    closeSettings();
    setOnboardingCompleted(false);
  };
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.mage
      .getAbout()
      .then((info) => {
        if (!cancelled) setAbout(info);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? describeError(err) : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-hidden p-[14px_16px]">
      <div className="flex flex-col gap-[3px]">
        <div className="text-[13px] font-semibold text-mg-text">Mage {about === null ? '' : `v${about.versions.app}`}</div>
        <div className="text-[11px] text-mg-sec">{t('settings.about.tagline')}</div>
        {/* La licencia de Mage, dicha en la propia app: es lo primero que busca quien va a instalar algo
            que ejecuta comandos en su maquina. */}
        <div className="text-[11px] text-mg-ter">
          {t('settings.about.license')}{' '}
          <code>LICENSE</code>.
        </div>
        {about !== null && (
          <div className="font-mono text-[10.5px] text-mg-ter">
            Electron {about.versions.electron} · Chromium {about.versions.chromium} · Node {about.versions.node}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[11.5px] font-semibold text-mg-body">{t('settings.about.thirdPartyTitle')}</div>
        <p className="text-[11px] leading-[1.5] text-mg-sec">
          {t('settings.about.thirdPartyText')}
          {about?.chromiumLicensesPath !== null && about !== null && (
            <>
              {' '}
              {t('settings.about.chromiumSeparate')}{' '}
              <button
                onClick={() => void window.mage.openPath(about.chromiumLicensesPath ?? '')}
                className="underline underline-offset-2 hover:text-mg-body"
              >
                {t('settings.about.openChromiumLicenses')}
              </button>
              .
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-[8px]">
        <button
          onClick={reopenOnboarding}
          data-about="reopen-onboarding"
          className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover"
        >
          {t('settings.about.reopenOnboarding')}
        </button>
      </div>
      {error !== null && <div className="text-[11px] text-mg-danger">{t('settings.about.noticesError', { error })}</div>}
      <pre
        data-about="notices"
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-mg-border-subtle bg-mg-code p-[10px] font-mono text-[10.5px] leading-[1.5] text-mg-sec"
      >
        {aboutNoticesText(about, error, t)}
      </pre>
    </div>
  );
}

function StorageSection({
  retention,
  onChange,
}: {
  readonly retention: ScratchRetention;
  readonly onChange: (retention: ScratchRetention) => void;
}): React.JSX.Element {
  const t = useT();
  // Los espacios entre trozos van fuera del catalogo, igual que los dejaba el JSX: tras el segundo <b> NO hay
  // espacio (el salto de linea del JSX original no lo ponia).
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        {t('settings.storage.intro')} <b>{t('settings.storage.warningLabel')}</b> {t('settings.storage.warningText')}{' '}
        <b>{t('settings.storage.warningEmphasis')}</b>
        {t('settings.storage.cliSettingPrefix')} <code>cleanupPeriodDays</code>
        {t('settings.storage.cliSettingSuffix')}
      </p>
      {SCRATCH_RETENTION_OPTIONS.map((option) => (
        <label key={option.value} className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
          <input
            type="radio"
            name="scratch-retention"
            className="mt-[3px]"
            checked={retention === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <span className="font-semibold">{t(option.label)}</span>
            <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t(option.hint)}</span>
          </span>
        </label>
      ))}
      <NewConversationFolderControl />
      <ImportedContextControl />
      <CloseBehaviorControl />
      <GhNoticeControl />
      <ArtifactControl />
      <KeepAliveSection />
      <McpServerSection />
    </div>
  );
}

const NEW_CONVERSATION_FOLDER_OPTIONS = [
  { value: 'scratch', label: 'settings.storage.newFolder.scratch', hint: 'settings.storage.newFolder.scratchHint' },
  { value: 'lastProject', label: 'settings.storage.newFolder.lastProject', hint: 'settings.storage.newFolder.lastProjectHint' },
] as const satisfies readonly { readonly value: NewConversationFolder; readonly label: MessageKey; readonly hint: MessageKey }[];

// Carpeta con la que nace «Nuevo chat» (P-028, 16). Mismo patron que CloseBehaviorControl.
function NewConversationFolderControl(): React.JSX.Element {
  const folder = useWorkbenchStore((s) => s.settings.newConversationFolder);
  const setFolder = useWorkbenchStore((s) => s.setNewConversationFolder);
  const t = useT();
  return (
    <div data-setting="new-conversation-folder" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.storage.newFolder.label')}</span>
      {NEW_CONVERSATION_FOLDER_OPTIONS.map((option) => (
        <label key={option.value} className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
          <input
            type="radio"
            name="new-conversation-folder"
            className="mt-[3px]"
            checked={folder === option.value}
            onChange={() => setFolder(option.value)}
          />
          <span>
            <span className="font-semibold">{t(option.label)}</span>
            <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t(option.hint)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// Cuánto historial arranca una conversación que continúa otra de un proveedor distinto («Migrar»).
function ImportedContextControl(): React.JSX.Element {
  const chars = useWorkbenchStore((s) => s.settings.importedContextMaxChars);
  const setChars = useWorkbenchStore((s) => s.setImportedContextMaxChars);
  // Se escribe libremente y se acota al salir del campo: acotar en cada tecla impediría teclear «12000».
  const [draft, setDraft] = useState(String(chars));
  const t = useT();
  const commit = (): void => {
    const value = Number(draft);
    if (Number.isFinite(value) && draft.trim().length > 0) setChars(value);
    setDraft(String(useWorkbenchStore.getState().settings.importedContextMaxChars));
  };
  return (
    <div data-setting="imported-context" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.storage.importedContext.label')}</span>
      <label className="flex items-center gap-[8px] text-[11.5px] text-mg-body">
        <input
          type="number"
          aria-label={t('settings.storage.importedContext.aria')}
          min={IMPORTED_CONTEXT_LIMITS.min}
          max={IMPORTED_CONTEXT_LIMITS.max}
          step={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          className="w-[96px] rounded-[6px] border border-mg-border-ctrl bg-mg-window p-[4px_7px] text-mg-body outline-none"
        />
        <span>{t('settings.storage.importedContext.unit')}</span>
      </label>
      <span className="text-[10.5px] leading-[1.45] text-mg-ter">
        {t('settings.storage.importedContext.hint', {
          min: formatInteger(IMPORTED_CONTEXT_LIMITS.min),
          max: formatInteger(IMPORTED_CONTEXT_LIMITS.max),
        })}
      </span>
    </div>
  );
}

// Aviso «PR: instala gh / inicia sesión en gh» de la fila del chat (grupo D, DA-3): se descarta para
// siempre desde el propio aviso, y aqui se recupera.
function GhNoticeControl(): React.JSX.Element {
  const dismissed = useWorkbenchStore((s) => s.settings.ghNoticeDismissed);
  const setDismissed = useWorkbenchStore((s) => s.setGhNoticeDismissed);
  const autoArchive = useWorkbenchStore((s) => s.settings.autoArchiveOnPrClose);
  const setAutoArchive = useWorkbenchStore((s) => s.setAutoArchiveOnPrClose);
  const t = useT();
  return (
    <div data-setting="gh-notice" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.storage.pullRequests.label')}</span>
      <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
        <input type="checkbox" className="mt-[3px]" checked={!dismissed} onChange={(e) => setDismissed(!e.target.checked)} />
        <span>
          <span className="font-semibold">{t('settings.storage.pullRequests.ghNotice')}</span>
          <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.storage.pullRequests.ghNoticeHint')}</span>
        </span>
      </label>
      <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
        <input type="checkbox" className="mt-[3px]" checked={autoArchive} onChange={(e) => setAutoArchive(e.target.checked)} />
        <span>
          <span className="font-semibold">{t('settings.storage.pullRequests.autoArchive')}</span>
          <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.storage.pullRequests.autoArchiveHint')}</span>
        </span>
      </label>
    </div>
  );
}

// D5 (#53): Artifact publica contenido en claude.ai y, con «Omitir permisos», el modelo podría hacerlo sin
// preguntar. Por eso es una elección explícita, apagada por defecto.
function ArtifactControl(): React.JSX.Element {
  const enabled = useWorkbenchStore((s) => s.settings.artifactEnabled);
  const setEnabled = useWorkbenchStore((s) => s.setArtifactEnabled);
  const t = useT();
  return (
    <div data-setting="artifact" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">CLAUDE CODE</span>
      <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
        <input type="checkbox" className="mt-[3px]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>
          <span className="font-semibold">{t('settings.storage.artifact.toggle')}</span>
          <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.storage.artifact.hint')}</span>
        </span>
      </label>
    </div>
  );
}

const CLOSE_BEHAVIOR_OPTIONS = [
  { value: 'ask', label: 'settings.storage.closeBehavior.ask', hint: 'settings.storage.closeBehavior.askHint' },
  { value: 'background', label: 'settings.storage.closeBehavior.background', hint: 'settings.storage.closeBehavior.backgroundHint' },
  { value: 'quit', label: 'settings.storage.closeBehavior.quit', hint: 'settings.storage.closeBehavior.quitHint' },
] as const satisfies readonly { readonly value: CloseBehavior; readonly label: MessageKey; readonly hint: MessageKey }[];

// Que hace la X de la ventana (P-028, 17). Es el sitio para deshacer el «Recordar mi decisión» del
// dialogo de cierre. Lee y escribe del store, como UiScaleControl. En macOS no aplica: alli el boton
// rojo siempre oculta y Cmd+Q sale.
function CloseBehaviorControl(): React.JSX.Element {
  const behavior = useWorkbenchStore((s) => s.settings.closeBehavior);
  const setCloseBehavior = useWorkbenchStore((s) => s.setCloseBehavior);
  const t = useT();
  return (
    <div data-setting="close-behavior" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.storage.closeBehavior.label')}</span>
      {CLOSE_BEHAVIOR_OPTIONS.map((option) => (
        <label key={option.value} className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
          <input
            type="radio"
            name="close-behavior"
            className="mt-[3px]"
            checked={behavior === option.value}
            onChange={() => setCloseBehavior(option.value)}
          />
          <span>
            <span className="font-semibold">{t(option.label)}</span>
            <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t(option.hint)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const SCRATCH_RETENTION_OPTIONS = [
  { value: 'never', label: 'settings.storage.retention.never', hint: 'settings.storage.retention.neverHint' },
  { value: 'session', label: 'settings.storage.retention.session', hint: 'settings.storage.retention.sessionHint' },
  { value: '7d', label: 'settings.storage.retention.week', hint: 'settings.storage.retention.weekHint' },
  { value: '30d', label: 'settings.storage.retention.month', hint: 'settings.storage.retention.monthHint' },
] as const satisfies readonly { readonly value: ScratchRetention; readonly label: MessageKey; readonly hint: MessageKey }[];

// Seccion "Atajos de teclado" (D5, PLAN-D5-KEYBINDINGS.md §8): catalogo agrupado por categoria, con
// buscador, captura de combinacion con deteccion de conflicto EN VIVO (§7) y restablecer por atajo/global.
function KeybindingsSection({
  overrides,
  onSetOverride,
  onResetAll,
}: {
  readonly overrides: readonly KeybindingOverride[];
  readonly onSetOverride: (actionId: string, keys: string | null) => void;
  readonly onResetAll: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const t = useT();
  const isMac = isMacPlatform();
  const normalizedQuery = query.trim().toLowerCase();
  const visibleActions = KEYBINDING_ACTIONS.filter((a) => a.label.toLowerCase().includes(normalizedQuery));
  // Set conserva el orden de PRIMERA aparicion: agrupa sin reordenar categorias a lo loco.
  const categories = Array.from(new Set(visibleActions.map((a) => a.category)));
  const orphanOverrides = overrides.filter((o) => !KEYBINDING_ACTIONS.some((a) => a.id === o.actionId));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <div className="flex items-center gap-[8px]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.keybindings.searchPlaceholder')}
          aria-label={t('settings.keybindings.searchAria')}
          className="min-w-0 flex-1 rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
        />
        <button
          onClick={onResetAll}
          className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[6px] text-[11px] text-mg-body2 hover:bg-mg-hover"
        >
          {t('settings.keybindings.resetAll')}
        </button>
      </div>

      {orphanOverrides.length > 0 && (
        <div role="status" className="rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[8px_10px] text-[10.5px] text-mg-warn-text">
          {t('settings.keybindings.orphans', {
            count: orphanOverrides.length,
            actions: orphanOverrides.map((o) => o.actionId).join(', '),
          })}
        </div>
      )}

      {categories.length === 0 && <div className="text-[11.5px] text-mg-muted">{t('settings.keybindings.noResults')}</div>}

      {categories.map((category) => (
        <div key={category} className="flex flex-col gap-[6px]">
          <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{category.toUpperCase()}</span>
          {visibleActions
            .filter((a) => a.category === category)
            .map((action) => (
              <KeybindingRow key={action.id} action={action} overrides={overrides} isMac={isMac} onSetOverride={onSetOverride} />
            ))}
        </div>
      ))}
    </div>
  );
}

// Combinacion EFECTIVA de una accion (override valido > default > null), en formato canonico crudo.
function effectiveKeysOf(action: KeybindingAction, overrides: readonly KeybindingOverride[]): string | null {
  const override = overrides.find((o) => o.actionId === action.id);
  if (override !== undefined && parseKeyCombo(override.keys) !== null) return override.keys;
  return action.defaultKeys;
}

// Fila de un atajo: etiqueta + combinacion actual + Cambiar/Restablecer. "Cambiar" entra en modo
// captura (el propio boton escucha el siguiente keydown); si choca con otra accion del mismo scope, se
// ofrece desvincular esa otra en vez de "ganar la ultima" en silencio (§7).
function KeybindingRow({
  action,
  overrides,
  isMac,
  onSetOverride,
}: {
  readonly action: KeybindingAction;
  readonly overrides: readonly KeybindingOverride[];
  readonly isMac: boolean;
  readonly onSetOverride: (actionId: string, keys: string | null) => void;
}): React.JSX.Element {
  const [capturing, setCapturing] = useState(false);
  const [conflict, setConflict] = useState<{ readonly keys: string; readonly otherActionId: string } | null>(null);
  const captureRef = useRef<HTMLButtonElement>(null);
  const t = useT();

  const effectiveKeys = effectiveKeysOf(action, overrides);
  const parsed = effectiveKeys === null ? null : parseKeyCombo(effectiveKeys);
  const hasOverride = overrides.some((o) => o.actionId === action.id);

  useEffect(() => {
    if (capturing) captureRef.current?.focus();
  }, [capturing]);

  const cancelCapture = (): void => {
    setConflict(null);
    setCapturing(false);
  };

  const commit = (keys: string): void => {
    onSetOverride(action.id, keys);
    setConflict(null);
    setCapturing(false);
  };

  const onCaptureKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      cancelCapture();
      return;
    }
    const combo = comboFromEvent(e, isMac);
    if (combo === null) return; // modificador suelto o tecla no soportada: sigue esperando
    const keys = formatKeyCombo(combo);
    if (keys === null) return;
    const found = findConflict({ actionId: action.id, keys, overrides });
    if (found !== null) {
      setConflict({ keys, otherActionId: found.actionId });
      return;
    }
    commit(keys);
  };

  const unlinkAndCommit = (): void => {
    if (conflict === null) return;
    onSetOverride(conflict.otherActionId, null);
    commit(conflict.keys);
  };

  return (
    <div className="flex flex-col gap-[4px] rounded-[8px] border border-mg-border-ctrl bg-mg-code p-[8px_10px]">
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-mg-body">{action.label}</span>
        {!capturing && (
          <>
            <span className="shrink-0 rounded-[5px] border border-mg-border-emph bg-mg-panel px-[7px] py-[2px] font-mono text-[10.5px] text-mg-body2">
              {parsed === null ? t('settings.keybindings.unbound') : displayKeyCombo(parsed, isMac)}
            </span>
            <button
              onClick={() => setCapturing(true)}
              className="shrink-0 rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
            >
              {t('settings.keybindings.change')}
            </button>
            <button
              onClick={() => onSetOverride(action.id, null)}
              disabled={!hasOverride}
              className="shrink-0 rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:opacity-40"
            >
              {t('settings.keybindings.reset')}
            </button>
          </>
        )}
        {capturing && conflict === null && (
          <button
            ref={captureRef}
            onKeyDown={onCaptureKeyDown}
            className="shrink-0 rounded-[6px] border border-mg-focus bg-mg-sel px-[10px] py-[3px] text-[10.5px] text-mg-sel-ink outline-none"
          >
            {t('settings.keybindings.capturing')}
          </button>
        )}
      </div>
      {conflict !== null && (
        <div role="alert" className="flex items-center gap-[8px] text-[10.5px] text-mg-danger">
          <span className="min-w-0 flex-1">
            {t('settings.keybindings.conflict', {
              keys: conflict.keys,
              action: KEYBINDING_ACTIONS.find((a) => a.id === conflict.otherActionId)?.label ?? conflict.otherActionId,
            })}
          </span>
          <button
            onClick={unlinkAndCommit}
            className="shrink-0 rounded-[6px] border border-mg-danger-border px-[8px] py-[3px] text-mg-danger hover:bg-mg-danger-bg"
          >
            {t('settings.keybindings.unlinkAndUse')}
          </button>
          <button onClick={cancelCapture} className="shrink-0 rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-mg-body2 hover:bg-mg-hover">
            {t('settings.keybindings.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

// Id de regla nueva: sufijo numerico por encima del mayor existente (las reglas persisten entre
// arranques; un contador que reinicia a 0 colisionaria con ids restaurados, patron de advanceTabSeqPast).
function nextRuleId(rules: readonly NotificationRule[]): string {
  let max = 0;
  for (const rule of rules) {
    const match = /^rule(\d+)$/.exec(rule.id);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return `rule${max + 1}`;
}

// Ejemplos de un clic (Ronda 3, item 4): el usuario no tenia por donde empezar con las regex. Van con
// clases [Aa] porque el matcher compila SIN el flag `i` (mismo comportamiento que en tiempo real).
// `label` es la clave del nombre: se traduce al pintar y al crear la regla (el nombre guardado es texto del usuario).
const RULE_PRESETS = [
  { label: 'settings.notifications.presets.error', pattern: '[Ee]rror|[Ff]all(o|ó|ido)|[Ff]ailed' },
  { label: 'settings.notifications.presets.decision', pattern: '[Cc]onfirma|[Nn]ecesito que|¿[Qq]uieres' },
  { label: 'settings.notifications.presets.longTask', pattern: '[Cc]ompletado|[Tt]erminado|[Dd]esplegado' },
] as const satisfies readonly { readonly label: MessageKey; readonly pattern: string }[];

type RulePreset = (typeof RULE_PRESETS)[number];

// Seccion de reglas: lista editable (label, patron, toggle, borrar) + "Añadir regla". La validacion
// del regex es EN VIVO: un patron invalido se marca en rojo y ademas se guarda desactivado de facto
// (el matcher lo ignora igualmente con su try/catch: doble cinturon).
function NotificationRulesSection({
  rules,
  onChange,
}: {
  readonly rules: readonly NotificationRule[];
  readonly onChange: (rules: readonly NotificationRule[]) => void;
}): React.JSX.Element {
  const t = useT();
  const patch = (id: string, changes: Partial<NotificationRule>): void =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const remove = (id: string): void => onChange(rules.filter((r) => r.id !== id));
  const add = (): void =>
    onChange([...rules, { id: nextRuleId(rules), label: '', pattern: '', enabled: true }]);
  const addPreset = (preset: RulePreset): void =>
    onChange([...rules, { id: nextRuleId(rules), label: t(preset.label), pattern: preset.pattern, enabled: true }]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto p-[14px_16px]">
      {/* Aclaracion pedida por el usuario (Ronda 3, item 4): creia que TODAS las notificaciones
          dependian de estas reglas y escribia regex para casos que ya funcionan solos. */}
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        <strong>{t('settings.notifications.noConfigNeeded')}</strong> {t('settings.notifications.noConfigNeededDetail')}
      </p>
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        {t('settings.notifications.extraPrefix')} <strong>{t('settings.notifications.extraEmphasis')}</strong>{' '}
        {t('settings.notifications.extraMiddle')} <strong>{t('settings.notifications.contentEmphasis')}</strong>{' '}
        {t('settings.notifications.extraSuffix')}
      </p>
      {rules.length === 0 && <div className="text-[11.5px] text-mg-muted">{t('settings.notifications.empty')}</div>}
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} onPatch={(c) => patch(rule.id, c)} onRemove={() => remove(rule.id)} />
      ))}
      <div className="flex flex-wrap items-center gap-[6px]">
        <button
          onClick={add}
          className="rounded-[7px] border border-mg-border-emph px-[12px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
        >
          {t('settings.notifications.addRule')}
        </button>
        <span className="text-[11px] text-mg-ter">{t('settings.notifications.presetsIntro')}</span>
        {RULE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addPreset(preset)}
            data-tip={preset.pattern}
            className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[5px] text-[11.5px] text-mg-sec hover:bg-mg-hover hover:text-mg-body"
          >
            {t(preset.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  onPatch,
  onRemove,
}: {
  readonly rule: NotificationRule;
  readonly onPatch: (changes: Partial<NotificationRule>) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const patternError = validatePattern(rule.pattern);
  const errorId = `rule-pattern-error-${rule.id}`;
  // Banco de pruebas del patron (Ronda 3, item 4): solo feedback en vivo, no se guarda en ningun
  // sitio. Usa el MISMO compilador que el matcher real, para que lo que se ve aqui sea lo que pasara.
  const [probe, setProbe] = useState('');
  const probeMatches = probe.length > 0 && compileSafely(rule.pattern)?.test(probe) === true;
  const t = useT();
  return (
    <div className="flex flex-col gap-[6px] rounded-[9px] border border-mg-border-ctrl bg-mg-code p-[10px]">
      <div className="flex items-center gap-[8px]">
        <input
          value={rule.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder={t('settings.notifications.ruleName')}
          aria-label={t('settings.notifications.ruleName')}
          className="w-[180px] rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[4px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
        />
        <label className="ml-auto flex items-center gap-[5px] text-[11px] text-mg-sec">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} />
          {t('settings.notifications.ruleEnabled')}
        </label>
        <button onClick={onRemove} data-tip={t('settings.notifications.removeRule')} aria-label={t('settings.notifications.removeRule')} className="text-[12px] text-mg-muted hover:text-mg-danger">
          <Icon name="trash" size={12} />
        </button>
      </div>
      <input
        value={rule.pattern}
        onChange={(e) => onPatch({ pattern: e.target.value })}
        placeholder={t('settings.notifications.patternPlaceholder')}
        aria-label={t('settings.notifications.patternAria')}
        aria-invalid={patternError !== null}
        aria-describedby={patternError !== null ? errorId : undefined}
        className={`w-full rounded-[6px] border bg-mg-panel px-[8px] py-[4px] font-mono text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted ${
          patternError === null ? 'border-mg-border-subtle' : 'border-mg-danger-emph'
        }`}
      />
      {patternError !== null && <div id={errorId} role="alert" className="text-[10.5px] text-mg-danger">{t('settings.notifications.invalidPattern', { error: patternError })}</div>}
      <div className="flex items-center gap-[8px]">
        <input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder={t('settings.notifications.probePlaceholder')}
          aria-label={t('settings.notifications.probeAria')}
          className="min-w-0 flex-1 rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[4px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
        />
        <span
          role="status"
          className={`shrink-0 text-[11px] ${probe.length === 0 ? 'text-mg-muted' : probeMatches ? 'text-mg-focus' : 'text-mg-ter'}`}
        >
          {probeResultText(probe, probeMatches, t)}
        </span>
      </div>
    </div>
  );
}

// Resultado del banco de pruebas: raya sin texto, y si no, si casa o no.
function probeResultText(probe: string, matches: boolean, t: Translate): string {
  if (probe.length === 0) return '—';
  return matches ? t('settings.notifications.probeMatches') : t('settings.notifications.probeNoMatch');
}

// Valida un patron en vivo; devuelve el mensaje de error o null si compila. Frontera segura.
function validatePattern(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// Carpetas autorizadas para lanzar un agente. Existe por una razon concreta: sin marcha atras, una
// lista de confianza es una puerta de un solo sentido — se autoriza una carpeta al vuelo, en un
// dialogo, y ya no hay donde deshacerlo.
//
// Solo lista lo que se autorizo EN MAGE. Lo que el usuario aceptara en el dialogo del propio CLI
// tambien cuenta a la hora de no volver a preguntar, pero no se pinta aqui y menos se borra: ese
// fichero es del CLI, Mage no lo escribe.
function TrustedFoldersSection(): React.JSX.Element {
  const folders = useWorkbenchStore((s) => s.settings.trustedFolders);
  const revokeTrustedFolder = useWorkbenchStore((s) => s.revokeTrustedFolder);
  // Autorizar desde aqui es EXACTAMENTE lo mismo que decir "sí" en el diálogo de confianza: se
  // reutiliza esa accion (guarda la carpeta y persiste los ajustes sin debounce) en vez de duplicar
  // el guardado. Sin dialogo pendiente, la parte de responder al que espera es un no-op.
  const answerTrustRequest = useWorkbenchStore((s) => s.answerTrustRequest);
  // Carpeta repetida que se intento añadir: se guarda la carpeta, no el aviso, para traducirlo al pintar.
  const [duplicateFolder, setDuplicateFolder] = useState<string | null>(null);
  const t = useT();

  const addFolder = async (): Promise<void> => {
    setDuplicateFolder(null);
    const folder = await window.mage.pickDirectory();
    if (folder === null) return; // el usuario cerro el selector nativo
    if (folders.includes(folder)) {
      setDuplicateFolder(folder);
      return;
    }
    await answerTrustRequest(folder, true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[16px]">
      <div className="text-[11.5px] leading-[1.6] text-mg-body2">
        {t('settings.trustedFolders.introStart')} <b>{t('settings.trustedFolders.introInside')}</b>{' '}
        {t('settings.trustedFolders.introApplies')} <b>{t('settings.trustedFolders.introHooks')}</b>{' '}
        {t('settings.trustedFolders.introConfig')} <code>.claude/</code>
        {t('settings.trustedFolders.introServers')} <b>MCP</b> {t('settings.trustedFolders.introEnd')}
        <div className="mt-[6px] text-mg-muted">{t('settings.trustedFolders.cliNote')}</div>
      </div>

      <div className="flex items-center gap-[10px]">
        <button
          onClick={() => void addFolder()}
          className="flex w-fit items-center gap-[6px] rounded-[6px] border border-mg-border-emph px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover"
        >
          <Icon name="plus" size={11} /> {t('settings.trustedFolders.add')}
        </button>
        {duplicateFolder !== null && (
          <span role="alert" className="text-[11px] text-mg-warn-text">
            {t('settings.trustedFolders.alreadyTrusted', { folder: duplicateFolder })}
          </span>
        )}
      </div>

      {folders.length === 0 ? (
        <div className="rounded-[7px] border border-mg-border-subtle p-[10px_12px] text-[11.5px] text-mg-muted">
          {t('settings.trustedFolders.empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {folders.map((folder) => (
            <li
              key={folder}
              className="flex items-center gap-[10px] rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_10px]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-mg-body" title={folder}>
                {folder}
              </span>
              <button
                onClick={() => void revokeTrustedFolder(folder)}
                aria-label={t('settings.trustedFolders.revokeAria', { folder })}
                className="flex-none rounded-[5px] border border-mg-border-emph px-[8px] py-[3px] text-[11px] text-mg-body2 transition-colors duration-90 ease-out hover:bg-mg-hover"
              >
                {t('settings.trustedFolders.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="text-[11px] text-mg-muted">{t('settings.trustedFolders.revokeNote')}</div>
    </div>
  );
}
