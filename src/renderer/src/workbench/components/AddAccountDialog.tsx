import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AccountInfo } from '@shared/accounts';
import { AGY_PROVIDER_ID, type ProviderAuthSummary } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { CliLoginPanel, useCliLogin } from './CliLoginPanel';

// Dialogo de alta de cuenta. Crea el directorio + enlaces compartidos y, EN EL MISMO PASO, lanza el
// login **por el CLI** (Fase 9.2): Mage spawnea `claude auth login`, abre su URL en una ventana
// privada del navegador y relaya el codigo que pegue el usuario. **Mage nunca ve el token.**
//
// Antes esto alojaba la pagina de login de Anthropic en una ventana propia de Electron. Se quito a
// proposito: es la unica conducta del proyecto que la pagina legal de Anthropic nombra de forma
// directa, y su puerto seguro esta redactado alrededor del binario del CLI sin modificar.
//
// Crear siempre implica intentar login -> no quedan cuentas "a medias". Si el login no cuaja, se
// puede reintentar o eliminar la cuenta ahi mismo (evita huerfanas).
//
// P-028, punto 41: arriba se elige el PROVEEDOR (Claude preseleccionado) y el cuerpo sale del tipo de
// alta que declara su adapter: `cli-oauth` es el flujo de siempre; `external` (agy) explica que su
// sesion vive fuera de Mage; `api-key` (gateway) lleva a Ajustes › Proveedores y modelos, que es donde
// esta su alta. El dialogo nunca pide ni muestra una clave.
const CLAUDE_FALLBACK: ProviderAuthSummary = { providerId: 'claude', label: 'Claude', kind: 'cli-oauth', reason: '' };

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
          loggedIn={accounts.filter((a) => a.loginStatus === 'logged_in')}
        />
      )}
    </AnimatePresence>
  );
}

function DialogBody({
  onClose,
  onRefresh,
  onDelete,
  loggedIn,
}: {
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onDelete: (configDir: string) => Promise<void>;
  // Cuentas con sesion viva: son las que se puede ADOPTAR en vez de iniciar sesion otra vez.
  readonly loggedIn: readonly { readonly id: string; readonly alias: string }[];
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<AccountInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); // errores de crear/borrar (no los del login)
  const providers = useProviderAuthList(setError);
  const [providerId, setProviderId] = useState(CLAUDE_FALLBACK.providerId);
  const provider = providers.find((p) => p.providerId === providerId) ?? CLAUDE_FALLBACK;
  const openSettings = useWorkbenchStore((s) => s.openSettings);

  // Login confirmado por el CLI: se refrescan las cuentas y se cierra.
  const login = useCliLogin(() => {
    void onRefresh()
      .catch((err: unknown) => setError(describe(err)))
      .finally(onClose);
  });

  // Cerrar con un login a medias dejaria un CLI esperando un codigo que ya nadie va a pegar.
  const closeAll = (): void => {
    login.cancel();
    onClose();
  };
  const dialogRef = useDialogA11y({ onClose: closeAll });

  // Crea la cuenta y arranca el login en la misma accion.
  const createAndLogin = (): void => {
    const clean = name.trim();
    if (clean.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    void window.mage
      .createAccount(clean)
      .then((account) => {
        setCreated(account);
        login.begin(account.configDir, email.trim().length > 0 ? email.trim() : null);
      })
      .catch((err: unknown) => setError(describe(err)))
      .finally(() => setBusy(false));
  };

  // Crea la cuenta heredando la sesion de otra: cero clics para quien ya tiene ~/.claude logueado.
  const createAndAdopt = (sourceConfigDir: string): void => {
    const clean = name.trim();
    if (clean.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    void window.mage
      .createAccount(clean)
      .then((account) => {
        setCreated(account);
        return window.mage.adoptLogin({ sourceConfigDir, targetConfigDir: account.configDir });
      })
      .then(() => onRefresh())
      .then(onClose)
      .catch((err: unknown) => setError(describe(err)))
      .finally(() => setBusy(false));
  };

  const retryLogin = (): void => {
    if (created !== null) login.begin(created.configDir, email.trim().length > 0 ? email.trim() : null);
  };

  // Borra la cuenta recien creada (desenlaza compartidas + borra dir) para no dejar huerfanas.
  const deleteOrphan = (): void => {
    login.cancel();
    if (created === null) {
      onClose();
      return;
    }
    setBusy(true);
    void onDelete(created.configDir)
      .catch((err: unknown) => setError(describe(err)))
      .finally(() => {
        setBusy(false);
        onClose();
      });
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
        className="flex w-[440px] flex-col gap-[14px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="addaccount-title" className="text-[13px] font-bold text-mg-text">
          Añadir cuenta
        </div>

        {login.phase === 'idle' && <ProviderPicker providers={providers} selected={provider.providerId} onSelect={setProviderId} />}
        {login.phase === 'idle' && provider.kind === 'cli-oauth' && (
          <>
            <FormPhase name={name} onName={setName} email={email} onEmail={setEmail} onSubmit={createAndLogin} />
            <AdoptSection accounts={loggedIn} disabled={name.trim().length === 0 || busy} onAdopt={createAndAdopt} />
          </>
        )}
        {provider.kind === 'external' && <ExternalProviderPanel provider={provider} />}
        {provider.kind === 'api-key' && <ApiKeyProviderPanel provider={provider} />}
        <CliLoginPanel login={login} />

        {error !== null && (
          <div role="alert" className="text-[11px] text-mg-danger">
            {error}
          </div>
        )}

        <div className="mt-[2px] flex justify-end gap-[8px]">
          {login.phase === 'idle' && provider.kind === 'external' && <SecondaryButton onClick={closeAll}>Cerrar</SecondaryButton>}
          {login.phase === 'idle' && provider.kind === 'api-key' && (
            <>
              <SecondaryButton onClick={closeAll}>Cancelar</SecondaryButton>
              <PrimaryButton
                onClick={() => {
                  closeAll();
                  openSettings('providers');
                }}
              >
                Abrir Proveedores y modelos
              </PrimaryButton>
            </>
          )}
          {login.phase === 'idle' && provider.kind === 'cli-oauth' && (
            <>
              <SecondaryButton onClick={closeAll}>Cancelar</SecondaryButton>
              <PrimaryButton onClick={createAndLogin} disabled={name.trim().length === 0 || busy}>
                {busy ? 'Creando…' : 'Crear e iniciar sesión'}
              </PrimaryButton>
            </>
          )}
          {login.phase !== 'idle' && (
            <>
              <SecondaryButton onClick={deleteOrphan}>
                {created === null ? 'Cancelar' : 'Eliminar cuenta'}
              </SecondaryButton>
              {login.phase === 'failed' && (
                <PrimaryButton onClick={retryLogin} disabled={busy}>
                  Reintentar
                </PrimaryButton>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// Lista de proveedores y su tipo de alta, de main. Si falla, el error se ve y queda Claude (el flujo
// de siempre), que no depende de esta lista.
function useProviderAuthList(onError: (message: string) => void): readonly ProviderAuthSummary[] {
  const [providers, setProviders] = useState<readonly ProviderAuthSummary[]>([CLAUDE_FALLBACK]);
  useEffect(() => {
    let alive = true;
    window.mage
      .listProviderAuth()
      .then((list) => alive && list.length > 0 && setProviders(list))
      .catch((err: unknown) => alive && onError(`No se pudo leer la lista de proveedores: ${describe(err)}`));
    return () => {
      alive = false;
    };
  }, [onError]);
  return providers;
}

// Botones y no radios a proposito: el formulario de Claude sigue teniendo exactamente sus dos campos
// de texto (lo mide la comprobacion 9.2 de verify:gui).
function ProviderPicker({
  providers,
  selected,
  onSelect,
}: {
  readonly providers: readonly ProviderAuthSummary[];
  readonly selected: string;
  readonly onSelect: (providerId: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">PROVEEDOR</span>
      <div role="group" aria-label="Proveedor de la cuenta" className="flex flex-wrap gap-[6px]">
        {providers.map((p) => (
          <button
            key={p.providerId}
            aria-pressed={p.providerId === selected}
            data-provider-kind={p.kind}
            onClick={() => onSelect(p.providerId)}
            className={`rounded-[6px] border px-[8px] py-[3px] text-[10.5px] transition-colors duration-150 ease-out hover:bg-mg-hover ${
              p.providerId === selected ? 'border-mg-focus text-mg-text' : 'border-mg-border-ctrl text-mg-body2'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExternalProviderPanel({ provider }: { readonly provider: ProviderAuthSummary }): React.JSX.Element {
  const installed = useAgyInstalledFor(provider.providerId);
  return (
    <div data-add-account-external="true" className="flex flex-col gap-[7px] rounded-[8px] border border-mg-border-ctrl bg-mg-block p-[10px_12px] text-[11.5px] leading-[1.55] text-mg-body2">
      <div>
        <b>{provider.label}</b> gestiona su sesión fuera de Mage: no hay cuenta que crear aquí. Inicia sesión con su
        propio CLI y Mage la usará en las pestañas de ese proveedor.
      </div>
      {provider.reason.length > 0 && <div className="text-[10.5px] text-mg-ter">{provider.reason}</div>}
      {installed !== null && (
        <div className="text-[10.5px]">{installed ? 'Instalado en este equipo.' : 'No está instalado en este equipo.'}</div>
      )}
    </div>
  );
}

// Estado de instalacion: solo se sabe preguntar por agy (es el unico `external` hoy). null = no aplica
// o aun no se sabe.
function useAgyInstalledFor(providerId: string): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    if (providerId !== AGY_PROVIDER_ID) return;
    let alive = true;
    window.mage
      .isAgyInstalled()
      .then((value) => alive && setInstalled(value))
      .catch((err: unknown) => console.warn('No se pudo comprobar si agy esta instalado:', describe(err)));
    return () => {
      alive = false;
    };
  }, [providerId]);
  return providerId === AGY_PROVIDER_ID ? installed : null;
}

function ApiKeyProviderPanel({ provider }: { readonly provider: ProviderAuthSummary }): React.JSX.Element {
  return (
    <div data-add-account-apikey="true" className="rounded-[8px] border border-mg-border-ctrl bg-mg-block p-[10px_12px] text-[11.5px] leading-[1.55] text-mg-body2">
      El alta de <b>{provider.label}</b> es su configuración: la dirección y la clave se guardan en Ajustes ›
      Proveedores y modelos. Sus pestañas corren sobre una de tus cuentas de Claude.
    </div>
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
        <span className="text-[10.5px] text-mg-ter">
          Solo prerrellena el formulario de Anthropic para que no te equivoques de cuenta.
        </span>
      </label>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled = false,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
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

function SecondaryButton({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded-[7px] border border-mg-border-emph px-[12px] py-[7px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover"
    >
      {children}
    </button>
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : `Error desconocido: ${String(err)}`;
}
