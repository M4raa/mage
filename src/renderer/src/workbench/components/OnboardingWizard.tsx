import { useEffect, useState } from 'react';
import { THEME_PREFERENCES, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, type ThemePreference } from '@shared/settings';
import type { ProviderProbeResult } from '@shared/ipc';
import { useWorkbenchStore } from '../workbenchStore';
import { providerOptions } from '../models';
import { isMacPlatform } from '../keybindings/platform';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { essentialShortcuts, installCommandFor, shouldShowOnboarding, stepAfter, stepBefore, type OnboardingStep } from '../onboarding';
import { Icon } from './Icon';
import { useT } from '../../i18n/uiLanguage';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import { describeError } from '../describeError';

// Asistente de PRIMER ARRANQUE. Lo que resuelve, y por lo que existe: Mage no instala el motor —es el
// CLI real de Claude Code— asi que una instalacion limpia puede quedarse en una pantalla que no
// funciona sin decir por que. Tres pasos: el motor (detectado o el comando para instalarlo), el
// aspecto (tema y escala) y los atajos del primer dia.
//
// NO es un modal de bienvenida decorativo: el paso 1 mide de verdad (`probeProvider`, el mismo sondeo
// que usa Configuracion) y el paso 2 aplica en caliente, asi que lo que el usuario elige se ve antes
// de cerrarlo.
//
// Se enseña una vez (`onboardingCompletedVersion`), y se puede volver a abrir desde
// Configuracion → Acerca de.

// Las tablas guardan la CLAVE y se traduce al pintar (se evalúan al importar, antes de saber el idioma).
const TITLES = {
  engine: 'dialogs.onboarding.stepEngine',
  appearance: 'dialogs.onboarding.stepAppearance',
  shortcuts: 'dialogs.onboarding.stepShortcuts',
} as const satisfies Readonly<Record<OnboardingStep, MessageKey>>;

const THEME_LABELS = {
  system: 'dialogs.onboarding.themeSystem',
  light: 'dialogs.onboarding.themeLight',
  dark: 'dialogs.onboarding.themeDark',
} as const satisfies Readonly<Record<ThemePreference, MessageKey>>;

export function OnboardingWizard(): React.JSX.Element | null {
  const t = useT();
  const settings = useWorkbenchStore((s) => s.settings);
  const setOnboardingCompleted = useWorkbenchStore((s) => s.setOnboardingCompleted);
  const [step, setStep] = useState<OnboardingStep>('engine');
  // El asistente no se cierra con Escape ni pulsando fuera: es la unica pantalla donde se explica que
  // hace falta el CLI, y cerrarla sin querer deja a alguien con una app que "no responde". Se sale por
  // el boton, que es lo que marca el ajuste. `useDialogA11y` sigue dando trampa de foco y foco inicial.
  const dialogRef = useDialogA11y({ onClose: () => undefined });

  if (!shouldShowOnboarding(settings)) return null;

  const finish = (): void => setOnboardingCompleted(true);
  const next = (): void => {
    const following = stepAfter(step);
    if (following === null) finish();
    else setStep(following);
  };
  const previous = stepBefore(step);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-mg-scrim" data-onboarding="overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex h-[min(80vh,560px)] w-[min(92vw,620px)] flex-col overflow-hidden rounded-[11px] border border-mg-border-pop bg-mg-panel text-[12px] mg-shadow-modal"
      >
        <div className="flex items-center gap-[9px] border-b border-mg-border p-[13px_16px]">
          <Icon name="sparkles" size={15} className="text-mg-focus" />
          <div id="onboarding-title" className="text-[13px] font-semibold text-mg-text">
            {t(TITLES[step])}
          </div>
          <div className="ml-auto flex items-center gap-[5px]" aria-hidden="true">
            {(['engine', 'appearance', 'shortcuts'] as const).map((candidate) => (
              <span
                key={candidate}
                className={`h-[5px] w-[5px] rounded-full ${candidate === step ? 'bg-mg-focus' : 'bg-mg-border-ctrl'}`}
              />
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
          {step === 'engine' && <EngineStep />}
          {step === 'appearance' && <AppearanceStep />}
          {step === 'shortcuts' && <ShortcutsStep />}
        </div>

        <div className="flex items-center gap-[8px] border-t border-mg-border p-[11px_16px]">
          <button onClick={finish} data-onboarding="skip" className="text-[11px] text-mg-ter underline underline-offset-2 hover:text-mg-body">
            {t('dialogs.onboarding.skip')}
          </button>
          <div className="ml-auto flex items-center gap-[8px]">
            {previous !== null && (
              <button
                onClick={() => setStep(previous)}
                className="rounded-[7px] border border-mg-border-ctrl px-[12px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
              >
                {t('dialogs.onboarding.back')}
              </button>
            )}
            <button
              onClick={next}
              data-onboarding="next"
              className="rounded-[7px] bg-mg-focus px-[14px] py-[5px] text-[11.5px] font-semibold text-mg-window hover:opacity-90"
            >
              {stepAfter(step) === null ? t('dialogs.onboarding.start') : t('dialogs.onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Paso 1: el motor ----------------------------------------------------------------------------

function EngineStep(): React.JSX.Element {
  const t = useT();
  const customProviders = useWorkbenchStore((s) => s.settings.customProviders);
  const defaultProvider = useWorkbenchStore((s) => s.settings.defaultProvider);
  const setDefaultProvider = useWorkbenchStore((s) => s.setDefaultProvider);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const { probe, recheck } = useProviderProbe(defaultProvider);
  const installCommand = installCommandFor(defaultProvider);
  const options = providerOptions(customProviders);

  return (
    <>
      <p className="text-[11.5px] leading-[1.55] text-mg-sec">
        {t('dialogs.onboarding.engineIntroStart')} <b>{t('dialogs.onboarding.engineIntroEmphasis')}</b> {t('dialogs.onboarding.engineIntroEnd')}
      </p>
      <label className="flex flex-col gap-[4px] text-[11px] text-mg-body2">
        {t('dialogs.onboarding.defaultProvider')}
        <select
          value={defaultProvider}
          onChange={(e) => setDefaultProvider(e.target.value)}
          className="rounded-[7px] border border-mg-border-ctrl bg-mg-block p-[6px_8px] text-[11.5px] text-mg-body"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-[7px] border border-mg-border-subtle bg-mg-block p-[10px_12px]" data-onboarding="engine-status">
        {probe === null ? (
          <div className="text-[11px] text-mg-ter">{t('dialogs.onboarding.checking')}</div>
        ) : probe.endpoint !== null ? (
          <div className="flex flex-col gap-[3px]">
            <div className="text-[11.5px] font-semibold text-mg-diff-add">{t('dialogs.onboarding.installed')}</div>
            <div className="break-all font-mono text-[10.5px] text-mg-ter">{probe.endpoint}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-[7px]">
            <div className="text-[11.5px] font-semibold text-mg-warn-text">{t('dialogs.onboarding.notInstalled')}</div>
            <div className="text-[11px] leading-[1.5] text-mg-sec">
              {probe.error ?? t('dialogs.onboarding.binaryNotFound')}
              {installCommand !== null && ` ${t('dialogs.onboarding.installHint')}`}
            </div>
            {installCommand !== null && <CommandToCopy command={installCommand} />}
            <button
              onClick={recheck}
              data-onboarding="recheck"
              className="self-start rounded-[6px] border border-mg-border-ctrl px-[9px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover"
            >
              {t('dialogs.onboarding.recheck')}
            </button>
          </div>
        )}
      </div>

      {accounts.length === 0 && defaultProvider === 'claude' && (
        <div className="rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[8px_11px] text-[11px] leading-[1.5] text-mg-warn-text">
          {t('dialogs.onboarding.noAccountStart')} <b>＋</b> {t('dialogs.onboarding.noAccountEnd')}
        </div>
      )}
    </>
  );
}

// Sondeo del proveedor elegido. Se rehace al cambiar de proveedor y al pulsar "Volver a comprobar":
// el usuario puede instalar el CLI con Mage abierto, que es justo lo que este paso le pide hacer.
function useProviderProbe(providerId: string): { readonly probe: ProviderProbeResult | null; readonly recheck: () => void } {
  // Solo los proveedores por CLI se sondean con su id: uno del usuario necesitaria su URL y su clave,
  // y esos ya los configuro el usuario a mano en Configuracion (aqui no se puede haber elegido uno que
  // no exista). `baseUrl`/`apiKey` en null = "mira el binario", que es el caso del primer arranque.
  const [result, setResult] = useState<ProviderProbeResult | null>(null);
  // Contador de reintentos: cambiarlo re-dispara el efecto. Es lo que convierte "Volver a comprobar" en
  // un sondeo de verdad y no en un boton decorativo.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    void window.mage
      .probeProvider({ providerId, baseUrl: null })
      .then((probe) => {
        if (!cancelled) setResult(probe);
      })
      .catch((err: unknown) => {
        // El sondeo no puede tumbar el asistente: se enseña como "no instalado" con el motivo, que es
        // lo mismo que ve el usuario y ademas es accionable.
        if (!cancelled) setResult({ kind: 'cli', endpoint: null, models: null, error: err instanceof Error ? describeError(err) : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, attempt]);

  return { probe: result, recheck: () => setAttempt((value) => value + 1) };
}

const COPY_LABEL = {
  idle: 'dialogs.onboarding.copy',
  copied: 'dialogs.onboarding.copied',
  failed: 'dialogs.onboarding.copyFailed',
} as const satisfies Readonly<Record<'idle' | 'copied' | 'failed', MessageKey>>;

function CommandToCopy({ command }: { readonly command: string }): React.JSX.Element {
  const t = useT();
  // El asistente va por encima de los toasts (z-[60]): el fallo se dice aqui, en el boton, y queda en el log.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = (): void => {
    void navigator.clipboard
      .writeText(command)
      .then(() => setCopyState('copied'))
      .catch((err: unknown) => {
        console.warn('No se pudo copiar el comando:', err);
        setCopyState('failed');
      });
  };
  return (
    <div className="flex items-center gap-[8px]">
      <code className="flex-1 break-all rounded-[6px] bg-mg-code p-[7px_9px] font-mono text-[10.5px] text-mg-body">{command}</code>
      <button
        onClick={copy}
        className="flex-none rounded-[6px] border border-mg-border-ctrl px-[9px] py-[5px] text-[11px] text-mg-body2 hover:bg-mg-hover"
      >
        {t(COPY_LABEL[copyState])}
      </button>
      {copyState === 'failed' && (
        <span role="alert" className="sr-only">
          {t('dialogs.onboarding.copyFailedAlert')}
        </span>
      )}
    </div>
  );
}

// --- Paso 2: aspecto -----------------------------------------------------------------------------

function AppearanceStep(): React.JSX.Element {
  const t = useT();
  const theme = useWorkbenchStore((s) => s.settings.theme);
  const setTheme = useWorkbenchStore((s) => s.setTheme);
  const uiScale = useWorkbenchStore((s) => s.settings.uiScale);
  const setUiScale = useWorkbenchStore((s) => s.setUiScale);

  return (
    <>
      <p className="text-[11.5px] leading-[1.55] text-mg-sec">
        {t('dialogs.onboarding.appearanceIntro')}
      </p>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[11px] font-semibold text-mg-body">{t('dialogs.onboarding.theme')}</div>
        <div className="flex gap-[7px]">
          {THEME_PREFERENCES.map((preference) => (
            <button
              key={preference}
              onClick={() => setTheme(preference)}
              aria-pressed={theme === preference}
              className={`flex-1 rounded-[7px] border p-[9px] text-[11.5px] ${
                theme === preference ? 'border-mg-focus bg-mg-sel text-mg-body' : 'border-mg-border-ctrl text-mg-body2 hover:bg-mg-hover'
              }`}
            >
              {t(THEME_LABELS[preference])}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="flex items-center gap-[8px]">
          <div className="text-[11px] font-semibold text-mg-body">{t('dialogs.onboarding.uiScale')}</div>
          <div className="ml-auto font-mono text-[11px] text-mg-ter" data-onboarding="scale-value">
            {uiScale} %
          </div>
        </div>
        <input
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          value={uiScale}
          aria-label={t('dialogs.onboarding.uiScale')}
          onChange={(e) => setUiScale(Number(e.target.value))}
          className="w-full"
        />
        <div className="text-[10.5px] leading-[1.45] text-mg-ter">
          {t('dialogs.onboarding.uiScaleHint')}
        </div>
      </div>
    </>
  );
}

// --- Paso 3: atajos ------------------------------------------------------------------------------

function ShortcutsStep(): React.JSX.Element {
  const t = useT();
  const overrides = useWorkbenchStore((s) => s.settings.keybindingOverrides);
  const openSettings = useWorkbenchStore((s) => s.openSettings);
  const setOnboardingCompleted = useWorkbenchStore((s) => s.setOnboardingCompleted);
  const shortcuts = essentialShortcuts(overrides, isMacPlatform());

  return (
    <>
      <p className="text-[11.5px] leading-[1.55] text-mg-sec">
        {t('dialogs.onboarding.shortcutsIntro')}
      </p>
      <div className="flex flex-col gap-[1px]" data-onboarding="shortcuts">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.actionId} className="flex items-center gap-[10px] rounded-[6px] p-[6px_8px] odd:bg-mg-block">
            <span className="text-[11.5px] text-mg-body2">{shortcut.label}</span>
            <kbd className="ml-auto rounded-[5px] border border-mg-border-ctrl bg-mg-code px-[7px] py-[2px] font-mono text-[10.5px] text-mg-body">
              {shortcut.keys}
            </kbd>
          </div>
        ))}
      </div>
      <button
        onClick={() => {
          // Completar ANTES de abrir Configuracion: si no, el asistente sigue montado por encima y el
          // usuario ve el dialogo que acaba de pedir tapado por este.
          setOnboardingCompleted(true);
          openSettings();
        }}
        className="self-start text-[11px] text-mg-icon underline underline-offset-2 hover:text-mg-body"
      >
        {t('dialogs.onboarding.openSettings')}
      </button>
    </>
  );
}
