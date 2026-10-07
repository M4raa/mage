import { Fragment, useEffect, useRef, useState } from 'react';
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
import { CHANGELOG_ENTRIES } from '../releaseNotesContent';

// Secciones de Configuracion (crece por secciones). Cada una tiene su glifo+etiqueta en la nav y su
// titulo de cabecera.
type SectionKey =
  | 'notifications'
  | 'providers'
  | 'appearance'
  | 'widget'
  | 'mcp'
  | 'hooksPermissions'
  | 'trustedFolders'
  | 'keybindings'
  | 'storage'
  | 'releaseNotes'
  | 'about';
// Grupos de la navegacion. NO se fusiona ni se mueve ninguna seccion: solo se agrupan, que es lo que
// convierte una lista plana de diez en algo escaneable. El orden de `SECTIONS` sigue siendo el orden
// de navegacion con flechas, asi que los grupos van seguidos.
type SectionGroup = 'General' | 'Apariencia' | 'Agentes' | 'Seguridad' | 'Acerca de';

const SECTIONS: readonly {
  readonly key: SectionKey;
  readonly group: SectionGroup;
  readonly icon: IconName;
  readonly nav: string;
  readonly title: string;
}[] = [
  { key: 'notifications', group: 'General', icon: 'bell', nav: 'Notificaciones', title: 'Reglas de notificación' },
  { key: 'storage', group: 'General', icon: 'broom', nav: 'Almacenamiento', title: 'Carpetas temporales de las conversaciones' },
  { key: 'appearance', group: 'Apariencia', icon: 'palette', nav: 'Apariencia', title: 'Apariencia' },
  { key: 'widget', group: 'Apariencia', icon: 'wand', nav: 'Widget flotante', title: 'Widget flotante' },
  { key: 'keybindings', group: 'Apariencia', icon: 'keyboard', nav: 'Atajos de teclado', title: 'Atajos de teclado' },
  { key: 'providers', group: 'Agentes', icon: 'plug', nav: 'Proveedores y modelos', title: 'Proveedores y modelos' },
  { key: 'mcp', group: 'Agentes', icon: 'puzzle', nav: 'MCP y conectores', title: 'MCP y conectores' },
  { key: 'hooksPermissions', group: 'Seguridad', icon: 'hook', nav: 'Hooks y permisos', title: 'Hooks y reglas de permisos' },
  { key: 'trustedFolders', group: 'Seguridad', icon: 'shield', nav: 'Carpetas de confianza', title: 'Carpetas donde se puede lanzar un agente' },
  // «Acerca de» va la ULTIMA y en su propio grupo: no es un ajuste, es donde viven los avisos de
  // terceros (B.2 de la revision de licencias de terceros — las 85 dependencias exigen conservar su copyright y el
  // bundle los borra, asi que este es el sitio donde la app los enseña).
  { key: 'releaseNotes', group: 'Acerca de', icon: 'sparkles', nav: 'Notas de versión', title: 'Notas de versión' },
  { key: 'about', group: 'Acerca de', icon: 'info', nav: 'Acerca de Mage', title: 'Acerca de Mage' },
];

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
            Configuración
          </div>
          {SECTIONS.map((s, index) => (
            <Fragment key={s.key}>
              {(index === 0 || SECTIONS[index - 1]?.group !== s.group) && (
                <div className="mt-[10px] mb-[3px] px-[10px] text-[9.5px] font-bold tracking-[.1em] text-mg-ter first:mt-0">
                  {s.group.toUpperCase()}
                </div>
              )}
              <button
                id={`settings-tab-${s.key}`}
                role="tab"
                aria-selected={s.key === section}
                aria-controls={`settings-panel-${s.key}`}
                tabIndex={s.key === section ? 0 : -1}
                onClick={() => setSection(s.key)}
                className={`flex items-center gap-[8px] rounded-[7px] px-[10px] py-[6px] text-left text-[11.5px] transition-colors duration-150 ease-out ${
                  s.key === section ? 'bg-mg-sel text-mg-body' : 'text-mg-body2 hover:bg-mg-hover'
                }`}
              >
                <Icon name={s.icon} className={s.key === section ? 'text-mg-focus' : 'text-mg-ter'} />
                {s.nav}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-mg-border p-[12px_16px]">
            <div className="text-[12.5px] font-semibold text-mg-text">{current.title}</div>
            <button onClick={closeSettings} data-tip="Cerrar" aria-label="Cerrar configuración" className="text-[14px] text-mg-muted hover:text-mg-body">
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
const THEME_OPTIONS: readonly { readonly value: ThemePreference; readonly label: string; readonly hint: string }[] = [
  { value: 'system', label: 'Sistema', hint: 'Sigue el tema del sistema operativo.' },
  { value: 'light', label: 'Claro', hint: 'Fuerza el tema claro.' },
  { value: 'dark', label: 'Oscuro', hint: 'Fuerza el tema oscuro.' },
];

// Seccion Apariencia: tema base (tarjetas) + temas importados de Open VSX. Todo se aplica al instante.
// Escala de la interfaz. Lee y escribe del store directamente en vez de viajar como dos props mas por
// `AppearanceSection`: es un control autonomo y el store ya es la fuente de verdad de los ajustes.
function UiScaleControl(): React.JSX.Element {
  const uiScale = useWorkbenchStore((s) => s.settings.uiScale);
  const setUiScale = useWorkbenchStore((s) => s.setUiScale);
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">ESCALA DE LA INTERFAZ</span>
      <div className="flex items-center gap-[12px]">
        <input
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          value={uiScale}
          onChange={(e) => setUiScale(Number(e.target.value))}
          aria-label="Escala de la interfaz"
          className="h-[4px] flex-1 cursor-pointer appearance-none rounded-full bg-mg-track accent-mg-fill"
        />
        <span data-setting="ui-scale" className="w-[42px] text-right font-mono text-[11px] tabular-nums text-mg-body2">
          {uiScale}%
        </span>
      </div>
      <span className="text-[10.5px] text-mg-muted">
        Escala todo (texto, iconos y separaciones) con el zoom del propio navegador, así que no deforma
        ningún elemento. Entre {UI_SCALE_MIN} y {UI_SCALE_MAX} %: por debajo el texto pequeño del chat
        deja de leerse y por encima el diálogo de Configuración no cabe en una ventana pequeña.
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
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[14px_16px]">
      <UiScaleControl />
      <div className="flex flex-col gap-[8px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">OPACIDAD DE LOS FONDOS</span>
        <div className="flex items-center gap-[12px]">
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={backgroundOpacity}
            onChange={(e) => onChangeBackgroundOpacity(Number(e.target.value))}
            aria-label="Opacidad de los fondos"
            className="h-[4px] flex-1 cursor-pointer appearance-none rounded-full bg-mg-track accent-mg-fill"
          />
          <span className="w-[42px] text-right font-mono text-[11px] tabular-nums text-mg-body2">{backgroundOpacity}%</span>
        </div>
        <span className="text-[10.5px] text-mg-muted">
          Por debajo del 100 % las superficies dejan ver lo que hay detrás. El mínimo es 50 %: más abajo el
          texto deja de leerse sobre un escritorio cualquiera. En Windows 11 se activa además el material
          acrílico del sistema; en macOS y Linux el fondo se mezcla con el color del tema.
        </span>
      </div>
      <div className="flex flex-col gap-[8px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">TEMA BASE</span>
        <div className="flex gap-[8px]">
          {THEME_OPTIONS.map((option) => {
            // Una tarjeta base solo esta "activa" si no hay tema importado activo.
            const selected = activeThemeId === null && option.value === theme;
            return (
              <button
                key={option.value}
                onClick={() => onChangeTheme(option.value)}
                data-tip={option.hint}
                aria-pressed={selected}
                className={`flex-1 rounded-[8px] border px-[12px] py-[10px] text-left ${
                  selected ? 'border-mg-focus bg-mg-sel text-mg-text' : 'border-mg-border-ctrl text-mg-body2 hover:bg-mg-hover'
                }`}
              >
                <div className="text-[12px] font-semibold">{option.label}</div>
                <div className="mt-[3px] text-[10.5px] leading-[1.4] text-mg-ter">{option.hint}</div>
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
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">DISPOSICIÓN DE PANELES</span>
        <div className="flex items-center justify-between gap-[8px]">
          <p className="text-[10.5px] leading-[1.5] text-mg-sec">
            Vuelve los paneles laterales/inferiores a su posición y tamaño de fábrica.
          </p>
          <button
            onClick={onResetPanelLayout}
            className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[6px] text-[11px] text-mg-body2 hover:bg-mg-hover"
          >
            Restablecer disposición
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
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        Una ventana pequeña siempre visible por encima de otras aplicaciones con los agentes en curso,
        el uso de la cuenta activa y las alertas. Haz clic en un agente para volver a esa conversación.
      </p>
      <label className="flex items-center gap-[8px] text-[11.5px] text-mg-body">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
        Mostrar widget flotante
      </label>
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
  const open = (version?: string): void => {
    closeSettings();
    openReleaseNotes(version);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        Lo que cambia en cada versión de Mage. Al actualizar se abre solo en una pestaña de novedades; desde
        aquí puedes volver a abrirla en cualquier versión.
      </p>
      <button
        onClick={() => open()}
        className="self-start rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-[11.5px] text-mg-body transition-colors duration-150 ease-out hover:bg-mg-hover"
      >
        Abrir las notas de versión
      </button>
      <ul className="flex flex-col gap-[1px]" aria-label="Versiones de Mage">
        {CHANGELOG_ENTRIES.map((entry) => (
          <li key={entry.version}>
            <button
              onClick={() => open(entry.version)}
              className="flex w-full items-baseline gap-[10px] rounded-[7px] px-[10px] py-[6px] text-left text-[11.5px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover"
            >
              <span className="font-mono text-mg-body">{entry.version}</span>
              <span className="text-mg-ter">{entry.label}</span>
              {entry.version === installed && <span className="text-[9.5px] text-mg-ter">instalada</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AboutSection(): React.JSX.Element {
  const closeSettings = useWorkbenchStore((s) => s.closeSettings);
  const setOnboardingCompleted = useWorkbenchStore((s) => s.setOnboardingCompleted);
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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-hidden p-[14px_16px]">
      <div className="flex flex-col gap-[3px]">
        <div className="text-[13px] font-semibold text-mg-text">Mage {about === null ? '' : `v${about.versions.app}`}</div>
        <div className="text-[11px] text-mg-sec">Wrapper multiagéntico y multi-proveedor sobre agentes de código.</div>
        {/* La licencia de Mage, dicha en la propia app: es lo primero que busca quien va a instalar algo
            que ejecuta comandos en su maquina. */}
        <div className="text-[11px] text-mg-ter">
          Software libre bajo licencia MIT. © 2026 M4raa. El texto completo viaja con la aplicación en{' '}
          <code>LICENSE</code>.
        </div>
        {about !== null && (
          <div className="font-mono text-[10.5px] text-mg-ter">
            Electron {about.versions.electron} · Chromium {about.versions.chromium} · Node {about.versions.node}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[11.5px] font-semibold text-mg-body">Licencias de terceros</div>
        <p className="text-[11px] leading-[1.5] text-mg-sec">
          Mage incorpora software libre de terceros. Abajo va la licencia completa de cada paquete que
          viaja en la aplicación, con su aviso de copyright.
          {about?.chromiumLicensesPath !== null && about !== null && (
            <>
              {' '}
              Los de Electron y Chromium van aparte:{' '}
              <button
                onClick={() => void window.mage.openPath(about.chromiumLicensesPath ?? '')}
                className="underline underline-offset-2 hover:text-mg-body"
              >
                abrir LICENSES.chromium.html
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
          Volver a ver el asistente de bienvenida
        </button>
      </div>
      {error !== null && <div className="text-[11px] text-mg-danger">No se pudieron leer los avisos: {error}</div>}
      <pre
        data-about="notices"
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-mg-border-subtle bg-mg-code p-[10px] font-mono text-[10.5px] leading-[1.5] text-mg-sec"
      >
        {about === null ? (error === null ? 'Cargando los avisos…' : '') : about.notices}
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
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        Una conversación creada sin elegir carpeta trabaja en una carpeta temporal propia. Aquí decides
        cuánto duran esas carpetas. <b>Ojo:</b> esto no afecta a la transcripción de la conversación, que
        la guarda el CLI en su propio directorio y <b>borra por su cuenta a los 30 días</b>
        (su ajuste <code>cleanupPeriodDays</code>). Son dos limpiezas distintas.
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
            <span className="font-semibold">{option.label}</span>
            <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{option.hint}</span>
          </span>
        </label>
      ))}
      <NewConversationFolderControl />
      <ImportedContextControl />
      <CloseBehaviorControl />
      <GhNoticeControl />
    </div>
  );
}

const NEW_CONVERSATION_FOLDER_OPTIONS: readonly {
  readonly value: NewConversationFolder;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: 'scratch', label: 'Una carpeta temporal', hint: 'Cada chat nuevo trabaja en su propia carpeta temporal.' },
  {
    value: 'lastProject',
    label: 'El último proyecto',
    hint: 'La carpeta de la conversación más reciente del historial. Si ya no existe, una temporal.',
  },
];

// Carpeta con la que nace «Nuevo chat» (P-028, 16). Mismo patron que CloseBehaviorControl.
function NewConversationFolderControl(): React.JSX.Element {
  const folder = useWorkbenchStore((s) => s.settings.newConversationFolder);
  const setFolder = useWorkbenchStore((s) => s.setNewConversationFolder);
  return (
    <div data-setting="new-conversation-folder" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">CARPETA DE UN CHAT NUEVO</span>
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
            <span className="font-semibold">{option.label}</span>
            <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{option.hint}</span>
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
  const commit = (): void => {
    const value = Number(draft);
    if (Number.isFinite(value) && draft.trim().length > 0) setChars(value);
    setDraft(String(useWorkbenchStore.getState().settings.importedContextMaxChars));
  };
  return (
    <div data-setting="imported-context" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">HISTORIAL AL CONTINUAR EN OTRO PROVEEDOR</span>
      <label className="flex items-center gap-[8px] text-[11.5px] text-mg-body">
        <input
          type="number"
          aria-label="Caracteres de historial al continuar en otro proveedor"
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
        <span>caracteres</span>
      </label>
      <span className="text-[10.5px] leading-[1.45] text-mg-ter">
        Al pasar una conversación de un proveedor a otro, el destino arranca con su historial (lo más reciente primero) como
        contexto. Entre {IMPORTED_CONTEXT_LIMITS.min.toLocaleString('es-ES')} y {IMPORTED_CONTEXT_LIMITS.max.toLocaleString('es-ES')}: cuenta en el
        contexto del modelo.
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
  return (
    <div data-setting="gh-notice" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">PULL REQUESTS</span>
      <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
        <input type="checkbox" className="mt-[3px]" checked={!dismissed} onChange={(e) => setDismissed(!e.target.checked)} />
        <span>
          <span className="font-semibold">Avisar si falta el GitHub CLI</span>
          <span className="block text-[10.5px] leading-[1.45] text-mg-ter">
            El PR y el CI de la rama se leen con gh. Sin gh, o sin sesión, la fila del chat lo dice.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
        <input type="checkbox" className="mt-[3px]" checked={autoArchive} onChange={(e) => setAutoArchive(e.target.checked)} />
        <span>
          <span className="font-semibold">Archivar al fusionar o cerrar el PR</span>
          <span className="block text-[10.5px] leading-[1.45] text-mg-ter">
            Cierra la conversación (si no está trabajando) y borra su worktree si no tiene cambios. La rama se queda.
          </span>
        </span>
      </label>
    </div>
  );
}

const CLOSE_BEHAVIOR_OPTIONS: readonly { readonly value: CloseBehavior; readonly label: string; readonly hint: string }[] = [
  { value: 'ask', label: 'Preguntar', hint: 'Al cerrar la ventana, Mage pregunta qué hacer.' },
  {
    value: 'background',
    label: 'Mantener en segundo plano',
    hint: 'La ventana se oculta y Mage sigue en la bandeja con los agentes trabajando.',
  },
  { value: 'quit', label: 'Cerrar Mage', hint: 'Cerrar la ventana sale de Mage y para los agentes.' },
];

// Que hace la X de la ventana (P-028, 17). Es el sitio para deshacer el «Recordar mi decisión» del
// dialogo de cierre. Lee y escribe del store, como UiScaleControl. En macOS no aplica: alli el boton
// rojo siempre oculta y Cmd+Q sale.
function CloseBehaviorControl(): React.JSX.Element {
  const behavior = useWorkbenchStore((s) => s.settings.closeBehavior);
  const setCloseBehavior = useWorkbenchStore((s) => s.setCloseBehavior);
  return (
    <div data-setting="close-behavior" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">AL CERRAR LA VENTANA</span>
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
            <span className="font-semibold">{option.label}</span>
            <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const SCRATCH_RETENTION_OPTIONS: readonly { readonly value: ScratchRetention; readonly label: string; readonly hint: string }[] = [
  { value: 'never', label: 'No borrar nunca', hint: 'Mage no toca nada. Las carpetas se acumulan en el temporal del sistema.' },
  {
    value: 'session',
    label: 'Al cerrar Mage (incógnito)',
    hint: 'No sobreviven a la sesión. Reabrir una de esas conversaciones la dejará sin carpeta de trabajo.',
  },
  { value: '7d', label: 'A los 7 días', hint: 'Se borran las que lleven una semana sin tocarse.' },
  { value: '30d', label: 'A los 30 días', hint: 'El mismo plazo que usa Claude Code para sus propias limpiezas.' },
];

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
          placeholder="Buscar atajo…"
          aria-label="Buscar atajo por nombre"
          className="min-w-0 flex-1 rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
        />
        <button
          onClick={onResetAll}
          className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[6px] text-[11px] text-mg-body2 hover:bg-mg-hover"
        >
          Restablecer todo
        </button>
      </div>

      {orphanOverrides.length > 0 && (
        <div role="status" className="rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[8px_10px] text-[10.5px] text-mg-warn-text">
          {orphanOverrides.length} atajo{orphanOverrides.length === 1 ? '' : 's'} personalizado{orphanOverrides.length === 1 ? '' : 's'} ya no
          aplica{orphanOverrides.length === 1 ? '' : 'n'} (la acción ya no existe): {orphanOverrides.map((o) => o.actionId).join(', ')}.
        </div>
      )}

      {categories.length === 0 && <div className="text-[11.5px] text-mg-muted">Sin resultados.</div>}

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
              {parsed === null ? 'Sin atajo' : displayKeyCombo(parsed, isMac)}
            </span>
            <button
              onClick={() => setCapturing(true)}
              className="shrink-0 rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
            >
              Cambiar
            </button>
            <button
              onClick={() => onSetOverride(action.id, null)}
              disabled={!hasOverride}
              className="shrink-0 rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:opacity-40"
            >
              Restablecer
            </button>
          </>
        )}
        {capturing && conflict === null && (
          <button
            ref={captureRef}
            onKeyDown={onCaptureKeyDown}
            className="shrink-0 rounded-[6px] border border-mg-focus bg-mg-sel px-[10px] py-[3px] text-[10.5px] text-mg-text outline-none"
          >
            Pulsa una combinación… (Escape cancela)
          </button>
        )}
      </div>
      {conflict !== null && (
        <div role="alert" className="flex items-center gap-[8px] text-[10.5px] text-mg-danger">
          <span className="min-w-0 flex-1">
            {conflict.keys} ya la usa «{KEYBINDING_ACTIONS.find((a) => a.id === conflict.otherActionId)?.label ?? conflict.otherActionId}» en
            este ámbito.
          </span>
          <button
            onClick={unlinkAndCommit}
            className="shrink-0 rounded-[6px] border border-mg-danger-border px-[8px] py-[3px] text-mg-danger hover:bg-mg-danger-bg"
          >
            Desvincular y usar aquí
          </button>
          <button onClick={cancelCapture} className="shrink-0 rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-mg-body2 hover:bg-mg-hover">
            Cancelar
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

interface RulePreset {
  readonly label: string;
  readonly pattern: string;
}

// Ejemplos de un clic (Ronda 3, item 4): el usuario no tenia por donde empezar con las regex. Van con
// clases [Aa] porque el matcher compila SIN el flag `i` (mismo comportamiento que en tiempo real).
const RULE_PRESETS: readonly RulePreset[] = [
  { label: 'Menciona un error', pattern: '[Ee]rror|[Ff]all(o|ó|ido)|[Ff]ailed' },
  { label: 'Necesita que decidas', pattern: '[Cc]onfirma|[Nn]ecesito que|¿[Qq]uieres' },
  { label: 'Terminó una tarea larga', pattern: '[Cc]ompletado|[Tt]erminado|[Dd]esplegado' },
];

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
  const patch = (id: string, changes: Partial<NotificationRule>): void =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const remove = (id: string): void => onChange(rules.filter((r) => r.id !== id));
  const add = (): void =>
    onChange([...rules, { id: nextRuleId(rules), label: '', pattern: '', enabled: true }]);
  const addPreset = (preset: RulePreset): void =>
    onChange([...rules, { id: nextRuleId(rules), label: preset.label, pattern: preset.pattern, enabled: true }]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto p-[14px_16px]">
      {/* Aclaracion pedida por el usuario (Ronda 3, item 4): creia que TODAS las notificaciones
          dependian de estas reglas y escribia regex para casos que ya funcionan solos. */}
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        <strong>No hace falta configurar nada</strong> para que Mage avise del fin de un turno, de un
        permiso pendiente o de un error: eso ya notifica siempre (si la ventana no tiene el foco).
      </p>
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        Estas reglas son solo un <strong>extra</strong> para avisar por el <strong>contenido</strong> del
        texto del agente: cuando ese texto coincida con el patrón (expresión regular) de una regla activa,
        se muestra además una notificación propia. Distingue mayúsculas y minúsculas.
      </p>
      {rules.length === 0 && <div className="text-[11.5px] text-mg-muted">No hay reglas todavía.</div>}
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} onPatch={(c) => patch(rule.id, c)} onRemove={() => remove(rule.id)} />
      ))}
      <div className="flex flex-wrap items-center gap-[6px]">
        <button
          onClick={add}
          className="rounded-[7px] border border-mg-border-emph px-[12px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
        >
          ＋ Añadir regla
        </button>
        <span className="text-[11px] text-mg-ter">o empieza por un ejemplo:</span>
        {RULE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addPreset(preset)}
            data-tip={preset.pattern}
            className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[5px] text-[11.5px] text-mg-sec hover:bg-mg-hover hover:text-mg-body"
          >
            {preset.label}
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
  return (
    <div className="flex flex-col gap-[6px] rounded-[9px] border border-mg-border-ctrl bg-mg-code p-[10px]">
      <div className="flex items-center gap-[8px]">
        <input
          value={rule.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="Nombre de la regla"
          aria-label="Nombre de la regla"
          className="w-[180px] rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[4px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
        />
        <label className="ml-auto flex items-center gap-[5px] text-[11px] text-mg-sec">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} />
          Activa
        </label>
        <button onClick={onRemove} data-tip="Eliminar regla" aria-label="Eliminar regla" className="text-[12px] text-mg-muted hover:text-mg-danger">
          <Icon name="trash" size={12} />
        </button>
      </div>
      <input
        value={rule.pattern}
        onChange={(e) => onPatch({ pattern: e.target.value })}
        placeholder="Patrón regex, p.ej. deploy (ok|listo)"
        aria-label="Patrón (expresión regular)"
        aria-invalid={patternError !== null}
        aria-describedby={patternError !== null ? errorId : undefined}
        className={`w-full rounded-[6px] border bg-mg-panel px-[8px] py-[4px] font-mono text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted ${
          patternError === null ? 'border-mg-border-subtle' : 'border-mg-danger-emph'
        }`}
      />
      {patternError !== null && <div id={errorId} role="alert" className="text-[10.5px] text-mg-danger">Regex inválida: {patternError}</div>}
      <div className="flex items-center gap-[8px]">
        <input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder="Texto de prueba (no se guarda)"
          aria-label="Texto de prueba para este patrón"
          className="min-w-0 flex-1 rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[4px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
        />
        <span
          role="status"
          className={`shrink-0 text-[11px] ${probe.length === 0 ? 'text-mg-muted' : probeMatches ? 'text-mg-focus' : 'text-mg-ter'}`}
        >
          {probe.length === 0 ? '—' : probeMatches ? '✓ notificaría' : '✗ no casa'}
        </span>
      </div>
    </div>
  );
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
  const [addError, setAddError] = useState<string | null>(null);

  const addFolder = async (): Promise<void> => {
    setAddError(null);
    const folder = await window.mage.pickDirectory();
    if (folder === null) return; // el usuario cerro el selector nativo
    if (folders.includes(folder)) {
      setAddError(`Esa carpeta ya estaba autorizada: ${folder}`);
      return;
    }
    await answerTrustRequest(folder, true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[16px]">
      <div className="text-[11.5px] leading-[1.6] text-mg-body2">
        Un agente se ejecuta <b>dentro</b> de la carpeta de su conversación y aplica lo que encuentre en
        ella: los <b>hooks</b> y la configuración de su <code>.claude/</code>, y los servidores{' '}
        <b>MCP</b> que declare. Mage pregunta la primera vez que vas a lanzar un agente en una carpeta
        nueva, y lo que autorices vale también para sus subcarpetas.
        <div className="mt-[6px] text-mg-muted">
          Aquí solo aparece lo autorizado desde Mage. Lo que aceptaste en el diálogo del CLI también
          cuenta para no volver a preguntar, pero se gestiona desde el CLI.
        </div>
      </div>

      <div className="flex items-center gap-[10px]">
        <button
          onClick={() => void addFolder()}
          className="flex w-fit items-center gap-[6px] rounded-[6px] border border-mg-border-emph px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover"
        >
          <Icon name="plus" size={11} /> Añadir carpeta…
        </button>
        {addError !== null && <span role="alert" className="text-[11px] text-mg-warn-text">{addError}</span>}
      </div>

      {folders.length === 0 ? (
        <div className="rounded-[7px] border border-mg-border-subtle p-[10px_12px] text-[11.5px] text-mg-muted">
          Todavía no has autorizado ninguna carpeta desde Mage.
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
                aria-label={`Retirar la confianza de ${folder}`}
                className="flex-none rounded-[5px] border border-mg-border-emph px-[8px] py-[3px] text-[11px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover"
              >
                Retirar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="text-[11px] text-mg-muted">
        Retirar una carpeta no detiene las conversaciones que ya están corriendo en ella: se volverá a
        preguntar la próxima vez que se lance un agente ahí.
      </div>
    </div>
  );
}
