import type { MageApi } from '@shared/ipc';
import type { AgyUsageSnapshot } from '@shared/usage';
import type { Account } from './types';
import type { WorkbenchState } from './workbenchStore';
import { applyAccentOverrides, assignMissingAccents, toAccountView } from './accountView';
import { applyCodexConfirmation, confirmCodexAccounts } from './codexAccountConfirmation';
import { toUsageWindows } from './usageView';
import { describeError } from './describeError';

// Cuentas (F2.5, division del store por dominio): descubrirlas, su catalogo de modelos, su uso y sus colores, y
// el estado del servicio. Fuera de `workbenchStore.ts` como las de PR, ajustes e historial; el store las mezcla
// tal cual. Este modulo es el UNICO que escribe `accounts`, `usageByAccount`, `modelCatalogByAccount` y `status`
// (borrar una cuenta, que cierra sus pestañas, sigue en el store).

export type AccountsActions = Pick<WorkbenchState, 'loadModelCatalog' | 'refreshAccounts' | 'refreshLogin' | 'assignAccountAccents' | 'refreshUsage' | 'refreshActiveUsage' | 'refreshStatus'>;

export interface AccountsDeps {
  readonly mage: MageApi;
  readonly get: () => WorkbenchState;
  readonly set: (fn: ((s: WorkbenchState) => Partial<WorkbenchState>) | Partial<WorkbenchState>) => void;
  readonly persistSettings: () => void;
  // Los colores se asignan solo con los ajustes ya cargados (si no, se pisarian los guardados).
  readonly isSettingsReady: () => boolean;
}

export function createAccountsActions(deps: AccountsDeps): AccountsActions {
  const { mage, get, set } = deps;
  return {
    // Descubre las cuentas en disco y las mapea a presentacion. Conserva la cuenta activa si sigue
    // existiendo; si no, elige la primera con login (o la primera disponible).
    loadModelCatalog: async (configDir) => {
      if (configDir.length === 0 || get().modelCatalogByAccount[configDir] !== undefined) return;
      const models = await mage.loadModelCatalog(configDir);
      if (models.length === 0 || get().modelCatalogByAccount[configDir] !== undefined) return;
      set((s) => ({ modelCatalogByAccount: { ...s.modelCatalogByAccount, [configDir]: models } }));
    },

    // «Refrescar sesión» (P-038): el CLI de la cuenta renueva su token y se relee su estado y su uso.
    refreshLogin: async (accountId) => {
      await mage.refreshLogin(accountId);
      await get().refreshAccounts();
      if (get().accounts.some((account) => account.id === accountId && account.loginStatus === 'logged_in')) await get().refreshUsage(accountId);
    },

    refreshAccounts: async () => {
      const infos = await mage.listAccounts();
      // Catalogo de modelos de cada cuenta (P-026 2.4): en segundo plano, no retrasa la lista.
      for (const info of infos) {
        void get()
          .loadModelCatalog(info.configDir)
          .catch((err: unknown) => console.warn('No se pudo leer el catalogo de modelos:', describeError(err)));
      }
      set((s) => {
        // toAccountView repone el placeholder de uso; re-fusionamos el uso real ya conocido para no
        // parpadear a 0% mientras se re-descubren las cuentas (el placeholder solo queda si no hay dato).
        const accounts = infos.map((infoItem) => {
          const view = toAccountView(infoItem, s.settings.accentByAccount[infoItem.configDir], s.settings.aliasByAccount[infoItem.configDir]);
          const info = s.usageByAccount[view.id];
          return info === null || info === undefined ? view : { ...view, usage: toUsageWindows(info, Date.now()) };
        });
        return {
          accounts,
          activeAccountId: accounts.some((a) => a.id === s.activeAccountId)
            ? s.activeAccountId
            : pickDefaultAccountId(accounts),
        };
      });
      confirmCodexAccounts(mage, infos, (confirmed) => set((state) => ({ accounts: applyCodexConfirmation(state.accounts, confirmed) })));
      if (deps.isSettingsReady()) get().assignAccountAccents();
    },

    assignAccountAccents: () => {
      const saved = get().settings.accentByAccount;
      const accentByAccount = assignMissingAccents(get().accounts.map((a) => a.id), saved);
      if (accentByAccount === saved) return;
      set((s) => ({ settings: { ...s.settings, accentByAccount }, accounts: applyAccentOverrides(s.accounts, accentByAccount) }));
      deps.persistSettings();
    },

    // Consulta el uso real de una cuenta (main cachea >=180 s) y lo fusiona en la Account de
    // presentacion (asi StatusBar/UsagePanel/Popover leen account.usage sin cambios). Ante error
    // (p.ej. sin login) guarda el mensaje en usageErrorByAccount para el dashboard; nunca lo traga.
    refreshUsage: async (configDir) => {
      if (configDir.length === 0) return;
      // Uso de SUSCRIPCION: Claude por su endpoint, Codex por lo que trae su sesion (`usage_limits`). Una
      // cuenta que factura la API no tiene ventanas, y agy por clave tampoco (el de su suscripcion va
      // aparte en el panel, por su `/usage`).
      const account = get().accounts.find((a) => a.id === configDir);
      if (account !== undefined && account.providerId === 'agy') {
        if (!account.apiBilled) await refreshAgyUsage(mage, set, configDir);
        return;
      }
      try {
        const info = await mage.getUsage(configDir);
        if (info === null) {
          set((s) => ({ usageErrorByAccount: { ...s.usageErrorByAccount, [configDir]: null } }));
          return;
        }
        const windows = toUsageWindows(info, Date.now());
        set((s) => ({
          usageByAccount: { ...s.usageByAccount, [configDir]: info },
          usageErrorByAccount: { ...s.usageErrorByAccount, [configDir]: null },
          accounts: s.accounts.map((a) => (a.id === configDir ? { ...a, usage: windows } : a)),
        }));
      } catch (err) {
        set((s) => ({ usageErrorByAccount: { ...s.usageErrorByAccount, [configDir]: describeError(err) } }));
      }
    },

    // Refresca el uso de la cuenta activa (la que muestran sidebar/status bar/dashboard).
    refreshActiveUsage: async () => {
      const accountId = get().activeAccountId;
      if (accountId.length > 0) await get().refreshUsage(accountId);
    },

    // Consulta el estado del servicio de Claude (global). Ante error, deja el status previo (best-effort).
    refreshStatus: async () => {
      try {
        const status = await mage.getStatus();
        set({ status });
      } catch (err) {
        // El estado es informativo (no critico): no rompemos la UI, pero lo dejamos trazado (se reintenta
        // en el proximo refresco). El forwarder de consola del renderer lo envia al LogBus.
        console.warn('No se pudo refrescar el estado de Claude:', describeError(err));
      }
    },
  };
}

// Cuenta activa por defecto: la primera SUSCRIPCION de Claude con login; si no, cualquiera con login;
// si no, la primera disponible; si no, "". Una cuenta que factura la API nunca es la de por defecto
// (grupo E): usarla tiene que ser una eleccion.
function pickDefaultAccountId(accounts: readonly Account[]): string {
  const subscription = accounts.find((a) => a.loginStatus === 'logged_in' && a.providerId === 'claude' && !a.apiBilled);
  const loggedIn = accounts.find((a) => a.loginStatus === 'logged_in' && !a.apiBilled);
  return (subscription ?? loggedIn ?? accounts[0])?.id ?? '';
}

// Uso de la suscripción de agy (su `/usage`, gratis; main cachea 180 s). Un fallo queda como `unavailable`.
async function refreshAgyUsage(mage: MageApi, set: AccountsDeps['set'], accountId: string): Promise<void> {
  const snapshot = await mage.readAgyUsage(accountId).catch((err: unknown): AgyUsageSnapshot => ({ status: 'unavailable', reason: describeError(err), fetchedAt: Date.now() }));
  set((s) => ({ agyUsageByAccount: { ...s.agyUsageByAccount, [accountId]: snapshot } }));
}
