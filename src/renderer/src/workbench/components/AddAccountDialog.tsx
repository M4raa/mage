import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AccountInfo } from '@shared/accounts';
import { AGY_PROVIDER_ID, PROVIDER_TEMPLATES, UNVERIFIED_PROVIDER_NOTE } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { ACCOUNT_VENDORS, accountHomeHint, accountKindsFor, type AccountKindOption, type AccountVendor } from '../accountKinds';
import { EMPTY_CUSTOM_PROVIDER_DRAFT, validateCustomProviderDraft, type CustomProviderDraft } from '../models';
import { CliLoginPanel, useCliLogin } from './CliLoginPanel';
import { ProviderForm } from './settings/ProvidersSection';

// Dialogo de alta de cuenta (grupo E): cualquier celda de la matriz FABRICANTE × FORMA DE PAGO.
//   - Claude · suscripcion: crea el dir + enlaces y lanza el login **por el CLI** (Fase 9.2): Mage
//     spawnea `claude auth login`, abre su URL en una ventana privada y relaya el codigo. Nunca ve el
//     token. Crear siempre implica intentar login -> no quedan cuentas "a medias".
//   - Claude, Codex o agy · clave de API: nombre y clave. La clave sube UNA vez a main, que la cifra en
//     su boveda; no vuelve nunca y solo la recibe el hijo de esa cuenta.
//   - Codex · suscripcion: crea su CODEX_HOME y abre el login de ChatGPT de su CLI (sin verificar).
//   - agy · suscripcion: vive fuera de Mage (una sola); se explica.
//   - Local: el formulario de proveedor de Ajustes, reutilizado aqui (IP:puerto).
export function AddAccountDialog(): React.JSX.Element {
  const open = useWorkbenchStore((s) => s.addAccountOpen);
  const close = useWorkbenchStore((s) => s.closeAddAccount);
  const refreshAccounts = useWorkbenchStore((s) => s.refreshAccounts);
  const deleteAccount = useWorkbenchStore((s) => s.deleteAccount);
  const accounts = useWorkbenchStore((s) => s.accounts);

  return (
    <AnimatePresence>
      {open && (
        <DialogBody
          key="add-account"
          onClose={close}
          onRefresh={refreshAccounts}
          onDelete={deleteAccount}
          loggedIn={accounts.filter((a) => a.loginStatus === 'logged_in' && a.provider === 'Claude' && !a.apiBilled)}
        />
      )}
    </AnimatePresence>
  );
}

interface BodyProps {
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onDelete: (configDir: string) => Promise<void>;
  // Cuentas de Claude con sesion viva: son las que se puede ADOPTAR en vez de iniciar sesion otra vez.
  readonly loggedIn: readonly { readonly id: string; readonly alias: string }[];
}

function DialogBody(props: BodyProps): React.JSX.Element {
  const [vendor, setVendor] = useState<AccountVendor>('anthropic');
  const kinds = accountKindsFor(vendor);
  const [kindIndex, setKindIndex] = useState(0);
  const kind = kinds[Math.min(kindIndex, kinds.length - 1)] ?? kinds[0]!;
  const [cancelLogin, setCancelLogin] = useState<() => void>(() => () => undefined);
  const closeAll = (): void => {
    cancelLogin();
    props.onClose();
  };
  const dialogRef = useDialogA11y({ onClose: closeAll });
  const pickVendor = (next: AccountVendor): void => {
    setVendor(next);
    setKindIndex(0);
  };

  return (
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim"
      onClick={closeAll}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="addaccount-title"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[460px] flex-col gap-[14px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="addaccount-title" className="text-[13px] font-bold text-mg-text">
          Añadir cuenta
        </div>
        <ChoiceGroup label="FABRICANTE" ariaLabel="Fabricante de la cuenta" options={ACCOUNT_VENDORS.map((v) => ({ key: v.id, label: v.label }))} selected={vendor} onSelect={(key) => pickVendor(key as AccountVendor)} />
        {kinds.length > 1 && (
          <ChoiceGroup label="FORMA DE PAGO" ariaLabel="Forma de pago de la cuenta" options={kinds.map((k, i) => ({ key: String(i), label: k.label, flow: k.flow }))} selected={String(kinds.indexOf(kind))} onSelect={(key) => setKindIndex(Number(key))} />
        )}
        {kind.unverified && <div className="text-[10.5px] leading-[1.5] text-mg-warn">{UNVERIFIED_PROVIDER_NOTE}</div>}
        <KindBody key={`${vendor}-${kind.flow}`} kind={kind} props={props} onClose={closeAll} onLoginCancel={setCancelLogin} />
      </motion.div>
    </motion.div>
  );
}

function KindBody({
  kind,
  props,
  onClose,
  onLoginCancel,
}: {
  readonly kind: AccountKindOption;
  readonly props: BodyProps;
  readonly onClose: () => void;
  readonly onLoginCancel: (cancel: () => void) => void;
}): React.JSX.Element {
  switch (kind.flow) {
    case 'cli-oauth':
      return <ClaudeSubscriptionBody {...props} onClose={onClose} onLoginCancel={onLoginCancel} />;
    case 'api-key':
      return <ApiKeyBody kind={kind} onRefresh={props.onRefresh} onClose={onClose} />;
    case 'codex-login':
      return <CodexLoginBody kind={kind} onRefresh={props.onRefresh} onDelete={props.onDelete} onClose={onClose} onLoginCancel={onLoginCancel} />;
    case 'external':
      return <ExternalBody onClose={onClose} />;
    case 'endpoint':
      return <LocalEndpointBody onClose={onClose} />;
  }
}

// --- Claude · suscripcion (el flujo de la 9.2) ------------------------------------------------------

function ClaudeSubscriptionBody({
  onClose,
  onRefresh,
  onDelete,
  loggedIn,
  onLoginCancel,
}: BodyProps & { readonly onLoginCancel: (cancel: () => void) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<AccountInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = useCliLogin(() => {
    void onRefresh()
      .catch((err: unknown) => setError(describe(err)))
      .finally(onClose);
  });
  useEffect(() => onLoginCancel(() => login.cancel), [login.cancel, onLoginCancel]);
  const hint = email.trim().length > 0 ? email.trim() : null;

  const createThen = (after: (account: AccountInfo) => Promise<void> | void): void => {
    if (name.trim().length === 0 || busy) return;
    setBusy(true);
    setError(null);
    void window.mage
      .createAccount(name.trim())
      .then(async (account) => {
        setCreated(account);
        await after(account);
      })
      .catch((err: unknown) => setError(describe(err)))
      .finally(() => setBusy(false));
  };
  const createAndLogin = (): void => createThen((account) => login.begin(account.configDir, hint));
  const createAndAdopt = (source: string): void =>
    createThen(async (account) => {
      await window.mage.adoptLogin({ sourceConfigDir: source, targetConfigDir: account.configDir });
      await onRefresh();
      onClose();
    });
  // Borra la cuenta recien creada (desenlaza compartidas + borra dir) para no dejar huerfanas.
  const deleteOrphan = (): void => {
    login.cancel();
    if (created === null) return onClose();
    setBusy(true);
    void onDelete(created.configDir)
      .catch((err: unknown) => setError(describe(err)))
      .finally(onClose);
  };

  return (
    <>
      {login.phase === 'idle' && (
        <>
          <FormPhase name={name} onName={setName} email={email} onEmail={setEmail} onSubmit={createAndLogin} />
          <AdoptSection accounts={loggedIn} disabled={name.trim().length === 0 || busy} onAdopt={createAndAdopt} />
        </>
      )}
      <CliLoginPanel login={login} />
      <ErrorLine error={error} />
      <div className="mt-[2px] flex justify-end gap-[8px]">
        {login.phase === 'idle' ? (
          <>
            <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
            <PrimaryButton onClick={createAndLogin} disabled={name.trim().length === 0 || busy}>
              {busy ? 'Creando…' : 'Crear e iniciar sesión'}
            </PrimaryButton>
          </>
        ) : (
          <>
            <SecondaryButton onClick={deleteOrphan}>{created === null ? 'Cancelar' : 'Eliminar cuenta'}</SecondaryButton>
            {login.phase === 'failed' && created !== null && (
              <PrimaryButton onClick={() => login.begin(created.configDir, hint)} disabled={busy}>
                Reintentar
              </PrimaryButton>
            )}
          </>
        )}
      </div>
    </>
  );
}

// --- Clave de API (Claude, Codex, agy) -----------------------------------------------------------

function ApiKeyBody({ kind, onRefresh, onClose }: { readonly kind: AccountKindOption; readonly onRefresh: () => Promise<void>; readonly onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0 && apiKey.trim().length > 0 && !busy && kind.providerId !== null;

  const submit = (): void => {
    if (!ready || kind.providerId === null) return;
    setBusy(true);
    setError(null);
    void window.mage
      .createProviderAccount({ providerId: kind.providerId, authKind: 'api-key', name: name.trim(), apiKey })
      .then(() => onRefresh())
      .then(onClose)
      .catch((err: unknown) => setError(describe(err)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <NameField name={name} onName={setName} onSubmit={submit} hint={`Se creará ${accountHomeHint(kind, name)}. Esta cuenta FACTURA LA API: sus pestañas llevan la marca «Factura API».`} />
      <label className="flex flex-col gap-[6px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">CLAVE DE API</span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          aria-label="Clave de API de la cuenta"
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] font-mono text-mg-body outline-none"
        />
        <span className="text-[10.5px] text-mg-ter">Se guarda cifrada en este equipo y no se vuelve a enseñar. Solo la recibe esta cuenta.</span>
      </label>
      <ErrorLine error={error} />
      <div className="mt-[2px] flex justify-end gap-[8px]">
        <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
        <PrimaryButton onClick={submit} disabled={!ready}>
          {busy ? 'Creando…' : 'Crear cuenta'}
        </PrimaryButton>
      </div>
    </>
  );
}

// --- Codex · suscripcion de ChatGPT (sin verificar) ----------------------------------------------

function CodexLoginBody({
  kind,
  onRefresh,
  onDelete,
  onClose,
  onLoginCancel,
}: {
  readonly kind: AccountKindOption;
  readonly onRefresh: () => Promise<void>;
  readonly onDelete: (configDir: string) => Promise<void>;
  readonly onClose: () => void;
  readonly onLoginCancel: (cancel: () => void) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [created, setCreated] = useState<AccountInfo | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onLoginCancel(() => () => void window.mage.cancelCodexLogin()), [onLoginCancel]);

  const login = (account: AccountInfo): void => {
    setWaiting(true);
    setError(null);
    void window.mage
      .startCodexLogin(account.configDir)
      .then(async (outcome) => {
        if (outcome.status !== 'ok') throw new Error(`El inicio de sesión de Codex no terminó (${outcome.status}: ${outcome.reason})`);
        await onRefresh();
        onClose();
      })
      .catch((err: unknown) => setError(describe(err)))
      .finally(() => setWaiting(false));
  };
  const create = (): void => {
    if (name.trim().length === 0 || waiting) return;
    void window.mage
      .createProviderAccount({ providerId: 'codex', authKind: 'subscription', name: name.trim() })
      .then((account) => {
        setCreated(account);
        login(account);
      })
      .catch((err: unknown) => setError(describe(err)));
  };
  const discard = (): void => {
    void window.mage.cancelCodexLogin();
    if (created === null) return onClose();
    void onDelete(created.configDir)
      .catch((err: unknown) => setError(describe(err)))
      .finally(onClose);
  };

  return (
    <>
      {created === null && <NameField name={name} onName={setName} onSubmit={create} hint={`Se creará ${accountHomeHint(kind, name)} y el CLI de Codex abrirá el inicio de sesión de ChatGPT en tu navegador.`} />}
      {waiting && <div className="rounded-[8px] border border-mg-border-ctrl bg-mg-block p-[10px_12px] text-[11.5px] text-mg-body2">Esperando a que termines el inicio de sesión en el navegador…</div>}
      <ErrorLine error={error} />
      <div className="mt-[2px] flex justify-end gap-[8px]">
        <SecondaryButton onClick={discard}>{created === null ? 'Cancelar' : 'Eliminar cuenta'}</SecondaryButton>
        {created === null && (
          <PrimaryButton onClick={create} disabled={name.trim().length === 0}>
            Crear e iniciar sesión
          </PrimaryButton>
        )}
        {created !== null && !waiting && (
          <PrimaryButton onClick={() => login(created)}>Reintentar</PrimaryButton>
        )}
      </div>
    </>
  );
}

// --- agy · suscripcion -------------------------------------------------------------------------

function ExternalBody({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const installed = useAgyInstalled();
  return (
    <>
      <div data-add-account-external="true" className="flex flex-col gap-[7px] rounded-[8px] border border-mg-border-ctrl bg-mg-block p-[10px_12px] text-[11.5px] leading-[1.55] text-mg-body2">
        <div>
          La suscripción de <b>agy</b> vive fuera de Mage: no hay cuenta que crear aquí. Inicia sesión con su
          propio CLI y Mage la usará en las pestañas de agy. Es una sola por equipo: su inicio de sesión no se
          guarda en una carpeta que Mage pueda separar.
        </div>
        {installed !== null && <div className="text-[10.5px]">{installed ? 'Instalado en este equipo.' : 'No está instalado en este equipo.'}</div>}
      </div>
      <div className="mt-[2px] flex justify-end gap-[8px]">
        <SecondaryButton onClick={onClose}>Cerrar</SecondaryButton>
      </div>
    </>
  );
}

function useAgyInstalled(): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    window.mage
      .isAgyInstalled()
      .then((value) => alive && setInstalled(value))
      .catch((err: unknown) => console.warn(`No se pudo comprobar si ${AGY_PROVIDER_ID} esta instalado:`, describe(err)));
    return () => {
      alive = false;
    };
  }, []);
  return installed;
}

// --- Local (IP:puerto): el formulario de proveedor de Ajustes ------------------------------------

const OLLAMA = PROVIDER_TEMPLATES[0];

function LocalEndpointBody({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const customProviders = useWorkbenchStore((s) => s.settings.customProviders);
  const saveProvider = useWorkbenchStore((s) => s.saveCustomProvider);
  const [draft, setDraft] = useState<CustomProviderDraft>(
    OLLAMA === undefined ? EMPTY_CUSTOM_PROVIDER_DRAFT : { ...EMPTY_CUSTOM_PROVIDER_DRAFT, label: OLLAMA.label, baseUrl: OLLAMA.baseUrl, models: OLLAMA.modelIds.join(', ') },
  );
  const [error, setError] = useState<string | null>(null);
  const submit = (): void => {
    const result = validateCustomProviderDraft(draft, customProviders, null);
    if (!result.ok) return setError(result.message);
    saveProvider(result.provider, result.apiKeyUpdate)
      .then(onClose)
      .catch((err: unknown) => setError(describe(err)));
  };
  return (
    <div data-add-account-local="true" className="flex flex-col gap-[8px]">
      <div className="text-[11px] leading-[1.5] text-mg-body2">
        Un servidor compatible con la API de OpenAI (Ollama, LM Studio…) en su IP y puerto. Sus conversaciones las
        ejecuta Mage por sí mismo (no hay CLI de por medio). «Probar conexión» rellena los modelos. Se puede editar en
        Ajustes › Proveedores y modelos.
      </div>
      <ProviderForm
        idSuffix="alta"
        draft={draft}
        savedApiKey={false}
        error={error}
        submitLabel="Añadir"
        onChange={(changes) => {
          setDraft({ ...draft, ...changes });
          setError(null);
        }}
        onSubmit={submit}
        onCancel={onClose}
      />
    </div>
  );
}

// --- Piezas ----------------------------------------------------------------------------------------

// Botones y no radios a proposito: el formulario de Claude sigue teniendo exactamente sus dos campos
// de texto (lo mide la comprobacion 9.2 de verify:gui).
function ChoiceGroup({
  label,
  ariaLabel,
  options,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly options: readonly { readonly key: string; readonly label: string; readonly flow?: string }[];
  readonly selected: string;
  readonly onSelect: (key: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{label}</span>
      <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-[6px]">
        {options.map((option) => (
          <button
            key={option.key}
            aria-pressed={option.key === selected}
            data-account-flow={option.flow}
            onClick={() => onSelect(option.key)}
            className={`rounded-[6px] border px-[8px] py-[3px] text-[10.5px] transition-colors duration-150 ease-out hover:bg-mg-hover ${
              option.key === selected ? 'border-mg-focus text-mg-text' : 'border-mg-border-ctrl text-mg-body2'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NameField({ name, onName, onSubmit, hint }: { readonly name: string; readonly onName: (v: string) => void; readonly onSubmit: () => void; readonly hint: string }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">NOMBRE</span>
      <input
        value={name}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        placeholder="p.ej. trabajo"
        aria-label="Nombre de la cuenta"
        className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] font-mono text-mg-body outline-none"
      />
      <span className="text-[10.5px] text-mg-ter">{hint}</span>
    </label>
  );
}

// Ofrece heredar la sesion de una cuenta que ya la tiene. No aparece si no hay ninguna: un boton que
// no puede hacer nada es peor que su ausencia.
function AdoptSection({
  accounts,
  disabled,
  onAdopt,
}: {
  readonly accounts: readonly { readonly id: string; readonly alias: string }[];
  readonly disabled: boolean;
  readonly onAdopt: (configDir: string) => void;
}): React.JSX.Element | null {
  if (accounts.length === 0) return null;
  return (
    <div className="flex flex-col gap-[7px] rounded-[8px] border border-mg-sel bg-mg-block p-[10px_12px] text-[11.5px] leading-[1.55] text-mg-body2">
      <div>
        …o <b>reutiliza una sesión que ya tienes</b>, sin iniciar sesión otra vez. La cuenta nueva tendrá su
        propio historial y ajustes, pero la misma identidad de Anthropic.
      </div>
      <div className="flex flex-wrap gap-[6px]">
        {accounts.map((account) => (
          <button
            key={account.id}
            disabled={disabled}
            onClick={() => onAdopt(account.id)}
            className="rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover disabled:opacity-40"
          >
            Usar la sesión de {account.alias}
          </button>
        ))}
      </div>
    </div>
  );
}

function FormPhase({
  name,
  onName,
  email,
  onEmail,
  onSubmit,
}: {
  readonly name: string;
  readonly onName: (value: string) => void;
  readonly email: string;
  readonly onEmail: (value: string) => void;
  readonly onSubmit: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[12px]">
      <label className="flex flex-col gap-[6px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">NOMBRE</span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          placeholder="p.ej. trabajo"
          className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] font-mono text-mg-body outline-none"
        />
        <span className="text-[10.5px] text-mg-ter">
          Se creará <span className="font-mono">~/.claude-{name.trim() || '<nombre>'}</span> con las carpetas
          compartidas enlazadas y, a continuación, <b>el CLI de Claude Code</b> abrirá el inicio de sesión en
          una <b>ventana privada</b> de tu navegador (suscripción, no consola/API).
        </span>
      </label>

      <label className="flex flex-col gap-[6px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">EMAIL (OPCIONAL)</span>
        <input
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          placeholder="tu@correo.com"
          className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] font-mono text-mg-body outline-none"
        />
        <span className="text-[10.5px] text-mg-ter">Solo prerrellena el formulario de Anthropic para que no te equivoques de cuenta.</span>
      </label>
    </div>
  );
}

function ErrorLine({ error }: { readonly error: string | null }): React.JSX.Element | null {
  if (error === null) return null;
  return (
    <div role="alert" className="text-[11px] text-mg-danger">
      {error}
    </div>
  );
}

function PrimaryButton({ onClick, disabled = false, children }: { readonly onClick: () => void; readonly disabled?: boolean; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-[7px] bg-mg-primary px-[12px] py-[7px] font-semibold text-mg-primary-ink transition-opacity duration-150 ease-out disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { readonly onClick: () => void; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <button onClick={onClick} className="rounded-[7px] border border-mg-border-emph px-[12px] py-[7px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover">
      {children}
    </button>
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : `Error desconocido: ${String(err)}`;
}
