import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { AnimatePresence, motion } from 'motion/react';
import { EFFORT_LEVELS } from '@shared/ipc';
import { isAutoApprovedProvider, isUnverifiedProvider, runsOnMageRuntime } from '@shared/providers';
import { apiBilledLabel } from '../accountView';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { displayModelId, modelOptionsForProvider, providerFallbackModel, providerOptions } from '../models';
import type { ProviderModel } from '@shared/providers';
import { resolveDefaultModel } from '../modelDefaults';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import type { Account } from '../types';
import { CliLoginPanel, useCliLogin } from './CliLoginPanel';
import { t as translate, useT } from '../../i18n/uiLanguage';
import { describeError } from '../describeError';

// Referencia ESTABLE para el selector de zustand (un array nuevo por render seria un bucle).
const NO_MODELS: readonly ProviderModel[] = [];

// Dialogo de nueva pestana: selecciona {cuenta, proyecto, proveedor, modelo} y abre una conversacion real
// aislada. El proyecto se elige con el selector de carpeta del SO (o carpeta temporal scratch).
export function NewTabDialog(): React.JSX.Element {
  const open = useWorkbenchStore((s) => s.newTabOpen);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  const newTab = useWorkbenchStore((s) => s.newTab);
  const closeNewTab = useWorkbenchStore((s) => s.closeNewTab);
  const refreshAccounts = useWorkbenchStore((s) => s.refreshAccounts);

  return (
    <AnimatePresence>
      {open && (
        <DialogBody
          key="new-tab"
          accounts={accounts}
          initialAccountId={activeAccountId}
          onRefreshAccounts={refreshAccounts}
          onCancel={closeNewTab}
          onSubmit={async (params) => {
            await newTab(params);
            closeNewTab();
          }}
        />
      )}
    </AnimatePresence>
  );
}

interface SubmitParams {
  readonly accountId: string;
  readonly cwd: string;
  readonly model: string;
  readonly provider: string;
  readonly effort?: string;
  readonly maxBudgetUsdCents?: number;
}

// Cuerpo del dialogo con estado propio; se monta solo cuando esta abierto (estado limpio cada vez).
function DialogBody({
  accounts,
  initialAccountId,
  onRefreshAccounts,
  onCancel,
  onSubmit,
}: {
  readonly accounts: readonly Account[];
  readonly initialAccountId: string;
  readonly onRefreshAccounts: () => Promise<void>;
  readonly onCancel: () => void;
  readonly onSubmit: (params: SubmitParams) => Promise<void>;
}): React.JSX.Element {
  const t = useT();
  const firstAccountId = accounts[0]?.id ?? '';
  const initialAccount = accounts.find((a) => a.id === initialAccountId) ?? accounts[0];
  const [accountId, setAccountId] = useState(initialAccountId || firstAccountId);
  // Proveedor inicial: el que el usuario eligio en el asistente (o cambio en Configuracion). Antes
  // estaba escrito 'claude' a mano aqui, asi que quien trabajaba con otro motor lo recambiaba en cada
  // conversacion nueva.
  const [provider, setProvider] = useState(() => initialAccount?.providerId ?? useWorkbenchStore.getState().settings.defaultProvider);
  const [model, setModel] = useState(() => initialAccount?.providerId === 'claude'
    ? initialAccount.defaultModel : (providerFallbackModel(initialAccount?.providerId ?? 'claude', useWorkbenchStore.getState().settings.customProviders) ?? 'sonnet'));
  const [cwd, setCwd] = useState('');
  const [effort, setEffort] = useState(''); // '' = por defecto (sin flag --effort)
  const [budgetUsd, setBudgetUsd] = useState(''); // dolares como texto; '' = sin tope
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-login de una cuenta caducada (Fase 9.2): lo hace el CLI, igual que el alta. Al confirmarlo el
  // propio CLI, se refrescan las cuentas para que el punto verde se actualice sin reabrir el dialogo.
  // El panel del codigo es el MISMO componente que usa el alta: una sola UI para un solo flujo.
  const relogin = useCliLogin(() => {
    void onRefreshAccounts().catch((err: unknown) => setError(describe(err)));
  });

  // Cerrar el dialogo (Escape, clic fuera, Cancelar) tiene que MATAR el CLI de re-login: si no, queda
  // un `claude setup-token` esperando un codigo que ya nadie va a pegar y el siguiente intento se
  // encuentra con "ya hay un login en curso" (lo avisa CliLoginPanel.tsx; AddAccountDialog ya lo hacia).
  const cancelAll = (): void => {
    relogin.cancel();
    onCancel();
  };
  const dialogRef = useDialogA11y({ onClose: cancelAll });

  // Modelos por defecto configurados por proveedor (F3). Referencia estable del estado: no crea objeto
  // nuevo por render (que en Zustand v5 provocaria un bucle de re-render).
  const defaultModelByProvider = useWorkbenchStore((s) => s.settings.defaultModelByProvider);
  // Proveedores añadidos por el usuario (E2): el selector ofrece los de serie MAS los suyos, y sus
  // modelos salen de su propia lista. Referencia estable del estado (no crear array por render).
  const customProviders = useWorkbenchStore((s) => s.settings.customProviders);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const providers = useMemo(() => providerOptions(customProviders), [customProviders]);
  // Modelos que el CLI publico para la cuenta elegida (P-026 2.4); sin sondear aun, la reserva.
  const claudeCatalog = useWorkbenchStore((s) => s.modelCatalogByAccount[accountId] ?? NO_MODELS);
  const modelOptions = useMemo(
    () => modelOptionsForProvider(provider, model, customProviders, claudeCatalog),
    [provider, model, customProviders, claudeCatalog],
  );
  // Proveedor sin puente de permisos (E3, `agy`): hay que avisar antes de abrir la pestana y, como su
  // CLI no lo instala Mage, comprobar que existe. null = aun sin respuesta (no se bloquea por eso).
  const autoApproved = isAutoApprovedProvider(provider);
  const agyInstalled = useAgyInstalled(autoApproved);
  // El runtime propio no usa la cuenta (A6): ni se enseña ni se exige.
  const onRuntime = runsOnMageRuntime(provider);
  const matchingAccount = selectedAccount?.providerId === provider;
  const canSubmit =
    (onRuntime || matchingAccount) && cwd.length > 0 && model.length > 0 && provider.length > 0 && !busy && agyInstalled !== false;

  // Al cambiar de cuenta, adopta su modelo por defecto (el usuario aun puede cambiarlo despues).
  const onAccountChange = (id: string): void => {
    setAccountId(id);
    const account = accounts.find((a) => a.id === id);
    if (account !== undefined) {
      setProvider(account.providerId);
      setModel(account.providerId === 'claude' ? account.defaultModel : (providerFallbackModel(account.providerId, customProviders) ?? ''));
      setEffort('');
    }
  };

  // Al cambiar de proveedor, el modelo pasa al configurado PARA ESE PROVEEDOR en Configuración (F3); si
  // no hay ninguno fijado, al primero de su catálogo. Antes siempre era el primero del catálogo, así que
  // configurar "gemini-2.5-pro" no servía de nada al abrir una conversación.
  const onProviderChange = (newProvider: string): void => {
    setProvider(newProvider);
    setAccountId(runsOnMageRuntime(newProvider) ? '' : (accounts.find((account) => account.providerId === newProvider)?.id ?? ''));
    setEffort('');
    setModel(
      resolveDefaultModel({
        lastUsedModel: null,
        // El `model` de settings.json es de Claude (es su fichero): no aplica a los demás proveedores.
        accountDefaultModel: newProvider === 'claude' ? (accounts.find((account) => account.providerId === newProvider)?.defaultModel ?? null) : null,
        providerDefaultModel: defaultModelByProvider[newProvider] ?? null,
        providerFallbackModel: providerFallbackModel(newProvider, customProviders),
      }),
    );
  };

  const pickProject = (): void => {
    void window.mage
      .pickDirectory()
      .then((dir) => {
        if (dir !== null) setCwd(dir);
      })
      .catch((err: unknown) => setError(describe(err)));
  };

  const reloginExpired = (configDir: string): void => {
    setError(null);
    relogin.begin(configDir, null);
  };

  const useScratch = (): void => {
    void window.mage
      .getScratchDir()
      .then((dir) => setCwd(dir))
      .catch((err: unknown) => setError(describe(err)));
  };

  const submit = (): void => {
    if (!canSubmit) return;
    // Convierte el tope de dolares (texto) a centavos ENTEROS; '' -> sin tope. Rechaza no-numeros/<=0.
    let maxBudgetUsdCents: number | undefined;
    if (budgetUsd.trim().length > 0) {
      const dollars = Number(budgetUsd);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setError(t('dialogs.newTab.invalidBudget', { value: budgetUsd }));
        return;
      }
      maxBudgetUsdCents = Math.round(dollars * 100);
    }
    setBusy(true);
    setError(null);
    void onSubmit({ accountId, cwd, model, provider, effort: effort.length > 0 ? effort : undefined, maxBudgetUsdCents }).catch(
      (err: unknown) => {
        setError(describe(err));
        setBusy(false);
      },
    );
  };

  return (
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim"
      onClick={cancelAll}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="newtab-title"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[420px] flex-col gap-[14px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="newtab-title" className="text-[13px] font-bold text-mg-text">{t('dialogs.newTab.title')}</div>

        {!onRuntime && (
          <Field label={t('dialogs.newTab.accountLabel')}>
            <select
              value={accountId}
              onChange={(e) => onAccountChange(e.target.value)}
              className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none"
            >
              {accounts.filter((a) => a.providerId === provider).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.alias} {a.email !== null ? `· ${a.email}` : ''} {a.apiBilled ? `· ${apiBilledLabel()}` : ''} {a.loginStatus !== 'logged_in' ? t('dialogs.newTab.noLoginSuffix') : ''}
                </option>
              ))}
            </select>
            {!matchingAccount && <span role="status" className="text-mg-warn-text">{t('dialogs.newTab.noMatchingAccount')}</span>}
            {selectedAccount !== undefined && selectedAccount.loginStatus !== 'logged_in' && provider === 'claude' && (
              <div className="flex items-center gap-[8px]">
                <span className="text-[10.5px] text-mg-danger">{t('dialogs.newTab.invalidLogin')}</span>
                <button
                  onClick={() => reloginExpired(selectedAccount.id)}
                  className="rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
                >
                  {t('dialogs.newTab.relogin')}
                </button>
              </div>
            )}
            <CliLoginPanel login={relogin} />
          </Field>
        )}

        <Field label={t('dialogs.newTab.projectLabel')}>
          <div className="flex items-center gap-[8px]">
            <button
              onClick={pickProject}
              className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[6px] text-mg-body2 hover:bg-mg-hover"
            >
              {t('dialogs.newTab.pickFolder')}
            </button>
            <button
              onClick={useScratch}
              className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[6px] text-mg-body2 hover:bg-mg-hover"
            >
              {t('dialogs.newTab.scratchFolder')}
            </button>
          </div>
          <span className="truncate font-mono text-[10.5px] text-mg-ter">{cwd.length > 0 ? cwd : t('dialogs.newTab.noFolder')}</span>
        </Field>

        <Field label={t('dialogs.newTab.providerLabel')}>
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('dialogs.newTab.modelLabel')}>
          <select
            value={displayModelId(model, modelOptions)}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none"
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        {isUnverifiedProvider(provider) && (
          <div data-unverified-provider="true" className="rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[8px_10px] text-[10.5px] text-mg-warn-text">
            {t('prompt.providers.unverifiedNote')}
          </div>
        )}
        {autoApproved && (
          // Aviso ANTES de abrir la pestana (E3): el usuario decide sabiendo que esa conversacion no
          // pasara por los dialogos de permiso de Mage. Y si el CLI no esta instalado, no se puede
          // abrir: ofrecerla como si funcionara seria mentir (el fallo saldria despues, en el chat).
          <div
            role="status"
            className="flex items-start gap-[8px] rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[8px_10px] text-[10.5px] text-mg-warn-text"
          >
            <Icon name="warning" />
            <span>
              {t('prompt.providers.noPermissionControl')}
              {agyInstalled === false && (
                <>
                  {' '}
                  <strong>{t('dialogs.newTab.agyMissingEmphasis')}</strong>{t('dialogs.newTab.agyMissingRest')}
                </>
              )}
            </span>
          </div>
        )}

        {(provider === 'claude' || provider === 'codex') && (
          <Field label={t('dialogs.newTab.effortLabel')}>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none"
            >
              <option value="">{t('dialogs.newTab.effortDefault')}</option>
              {(provider === 'codex' ? modelOptions.find((option) => option.id === model)?.supportedEfforts ?? [] : EFFORT_LEVELS).map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </Field>
        )}

        {provider === 'claude' && (
          <Field label={t('dialogs.newTab.budgetLabel')}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={budgetUsd}
              onChange={(e) => setBudgetUsd(e.target.value)}
              placeholder={t('dialogs.newTab.budgetPlaceholder')}
              className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none"
            />
          </Field>
        )}

        {error !== null && <div role="alert" className="text-[11px] text-mg-danger">{error}</div>}

        <div className="mt-[2px] flex justify-end gap-[8px]">
          <button
            onClick={cancelAll}
            className="rounded-[7px] border border-mg-border-emph px-[12px] py-[7px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover"
          >
            {t('dialogs.newTab.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-[7px] bg-mg-primary px-[12px] py-[7px] font-semibold text-mg-primary-ink transition-opacity duration-150 ease-out disabled:opacity-40"
          >
            {busy ? t('dialogs.newTab.opening') : t('dialogs.newTab.open')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ¿Esta instalado el CLI `agy` (E3)? Solo se pregunta cuando el proveedor elegido lo necesita, y se
// re-pregunta al volver a elegirlo (el usuario puede instalarlo con Mage abierto). null = sin respuesta
// todavia o proveedor que no lo necesita; un fallo de IPC se trata como "no instalado" y el aviso lo
// explica (nunca se asume que existe algo que no se ha podido comprobar).
function useAgyInstalled(needed: boolean): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!needed) {
      setInstalled(null);
      return;
    }
    let cancelled = false;
    void window.mage
      .isAgyInstalled()
      .then((value) => {
        if (!cancelled) setInstalled(value);
      })
      .catch(() => {
        if (!cancelled) setInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needed]);
  return installed;
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? describeError(err) : translate('dialogs.newTab.unknownError', { error: String(err) });
}
