import type { MageApi } from '@shared/ipc';
import { clampUiScale, DEFAULT_PERMISSION_MODES, IMPORTED_CONTEXT_LIMITS, ONBOARDING_VERSION, RUNTIME_SHELLS } from '@shared/settings';
import { setAgyCommandVerdict } from '@shared/agyRules';
import { applyAccentOverrides } from './accountView';
import { effortSettingKey } from './models';
import { applyBackgroundOpacity, applyThemeFromSettings, systemPrefersDark } from './theme';
import type { WorkbenchState } from './workbenchStore';
import { describeError } from './describeError';

// Ajustes de la app (F2.5, division del store por dominio): las acciones que solo cambian `settings` (y su
// reflejo inmediato en el DOM, la ventana o los colores de las cuentas) y lo persisten. Viven fuera de
// `workbenchStore.ts` como las de PR; el store las mezcla tal cual, asi que el contrato no cambia. Este modulo
// es el UNICO que escribe `settings` tras la carga inicial (que hace `init`).

export type SettingsActionName =
  | 'saveNotificationRules'
  | 'setTheme'
  | 'setUiScale'
  | 'setAccountAccent'
  | 'setClaudeAiConnectorsEnabled'
  | 'setAgyCommandVerdict'
  | 'setAgyLinkedPaths'
  | 'setDefaultProvider'
  | 'setArtifactEnabled'
  | 'setDefaultPermissionMode'
  | 'setRuntimeToolAccess'
  | 'setRuntimeShell'
  | 'setOnboardingCompleted'
  | 'setScratchRetention'
  | 'setCloseBehavior'
  | 'setNewConversationFolder'
  | 'setImportedContextMaxChars'
  | 'setBackgroundOpacity'
  | 'applyImportedTheme'
  | 'removeImportedTheme'
  | 'selectImportedTheme'
  | 'setWidgetEnabled'
  | 'setDefaultModelForProvider'
  | 'setKeybindingOverride'
  | 'resetAllKeybindings'
  | 'saveCustomProvider'
  | 'removeCustomProvider';

export type SettingsActions = Pick<WorkbenchState, SettingsActionName>;

export interface SettingsDeps {
  readonly mage: MageApi;
  readonly get: () => WorkbenchState;
  readonly set: (fn: (s: WorkbenchState) => Partial<WorkbenchState>) => void;
  // Guardado con debounce, inmediato (lo que main lee al lanzar un CLI) y confirmado por main (A14).
  readonly persistSettings: () => void;
  readonly persistSettingsNow: () => void;
  readonly saveSettingsConfirmed: () => Promise<void>;
  readonly pushWidgetSnapshot: () => void;
  // Si las novedades no se abren en esta ejecucion (dev sin la variable del harness).
  readonly isReleaseNotesDevRun: () => boolean;
}

export function createSettingsActions(deps: SettingsDeps): SettingsActions {
  const { mage, get, set } = deps;
  return {
    // Sustituye las reglas de notificacion (edicion completa desde SettingsView) y persiste.
    saveNotificationRules: (rules) => {
      set((s) => ({ settings: { ...s.settings, notificationRules: rules } }));
      deps.persistSettings();
    },

    // Cambia la preferencia de tema base. Elegir claro/oscuro/sistema DESACTIVA cualquier tema importado
    // (activeThemeId -> null). Aplica al DOM ya (feedback inmediato) y persiste con debounce.
    setTheme: (pref) => {
      set((s) => ({ settings: { ...s.settings, theme: pref, activeThemeId: null } }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      deps.persistSettings();
    },

    setUiScale: (percent) => {
      // Se acota en el store y no solo en el deslizador: esta accion es el contrato, y un valor de
      // fuera (un ajuste a mano, una version futura) no puede dejar la app ilegible.
      const clamped = clampUiScale(percent);
      set((s) => ({ settings: { ...s.settings, uiScale: clamped } }));
      mage.setUiScale(clamped);
      deps.persistSettings();
    },

    // PERS-3 (P-028, 2): color de una cuenta. `undefined` vuelve al de su posicion.
    setAccountAccent: (accountId, colorIndex) => {
      set((s) => {
        const { [accountId]: _previo, ...rest } = s.settings.accentByAccount;
        const accentByAccount = colorIndex === undefined ? rest : { ...rest, [accountId]: colorIndex };
        return { settings: { ...s.settings, accentByAccount }, accounts: applyAccentOverrides(s.accounts, accentByAccount) };
      });
      deps.persistSettings();
    },

    setClaudeAiConnectorsEnabled: (accountId, enabled) => {
      set((s) => {
        const rest = s.settings.claudeAiConnectorsOff.filter((id) => id !== accountId);
        return { settings: { ...s.settings, claudeAiConnectorsOff: enabled ? rest : [...rest, accountId] } };
      });
      deps.persistSettings();
    },

    setAgyCommandVerdict: (command, verdict) => {
      set((s) => ({ settings: { ...s.settings, agyCommandRules: setAgyCommandVerdict(s.settings.agyCommandRules, command, verdict) } }));
      deps.persistSettingsNow();
    },

    setAgyLinkedPaths: (paths) => {
      set((s) => ({ settings: { ...s.settings, agyLinkedPaths: paths } }));
      deps.persistSettingsNow();
    },

    setDefaultProvider: (providerId) => {
      set((s) => ({ settings: { ...s.settings, defaultProvider: providerId } }));
      deps.persistSettings();
    },

    setArtifactEnabled: (enabled) => {
      set((s) => ({ settings: { ...s.settings, artifactEnabled: enabled } }));
      deps.persistSettings();
    },

    setDefaultPermissionMode: (mode) => {
      if (!DEFAULT_PERMISSION_MODES.includes(mode)) throw new Error(`Modo de permiso por defecto invalido: ${JSON.stringify(mode)}`);
      set((s) => ({ settings: { ...s.settings, defaultPermissionMode: mode } }));
      deps.persistSettings();
    },

    setRuntimeToolAccess: (providerId, rules) => {
      set((s) => {
        const { [providerId]: _previous, ...rest } = s.settings.runtimeToolAccess;
        return { settings: { ...s.settings, runtimeToolAccess: rules.length === 0 ? rest : { ...rest, [providerId]: rules } } };
      });
      deps.persistSettings();
    },

    setRuntimeShell: (shell) => {
      if (!RUNTIME_SHELLS.includes(shell)) throw new Error(`Shell del runtime invalida: ${JSON.stringify(shell)}`);
      set((s) => ({ settings: { ...s.settings, runtimeShell: shell } }));
      deps.persistSettings();
    },

    setOnboardingCompleted: (completed) => {
      set((s) => ({ settings: { ...s.settings, onboardingCompletedVersion: completed ? ONBOARDING_VERSION : 0 } }));
      deps.persistSettings();
      // Una actualizacion que llego con el asistente a medias se enseña ahora, no debajo de el.
      if (!completed) return;
      void get()
        .showReleaseNotesIfUpdated(deps.isReleaseNotesDevRun())
        .catch((err: unknown) => console.warn('No se pudieron comprobar las novedades:', describeError(err)));
    },

    setScratchRetention: (retention) => {
      set((s) => ({ settings: { ...s.settings, scratchRetention: retention } }));
      deps.persistSettings();
    },

    setCloseBehavior: (behavior) => {
      set((s) => ({ settings: { ...s.settings, closeBehavior: behavior } }));
      deps.persistSettings();
    },

    setNewConversationFolder: (folder) => {
      set((s) => ({ settings: { ...s.settings, newConversationFolder: folder } }));
      deps.persistSettings();
    },

    setImportedContextMaxChars: (chars) => {
      // Se acota aqui y no solo en la UI: el store es el contrato, el input no es su unico llamante.
      const clamped = Math.min(IMPORTED_CONTEXT_LIMITS.max, Math.max(IMPORTED_CONTEXT_LIMITS.min, Math.round(chars)));
      set((s) => ({ settings: { ...s.settings, importedContextMaxChars: clamped } }));
      deps.persistSettings();
    },

    setBackgroundOpacity: (percent) => {
      // Se acota AQUI y no solo en la UI: esta accion es parte del contrato del store y un slider no es
      // su unico llamante posible. Por debajo de 50 el texto deja de leerse sobre un escritorio
      // cualquiera, y un ajuste que permite romper la app no es un ajuste.
      const clamped = Math.min(100, Math.max(50, Math.round(percent)));
      set((s) => ({ settings: { ...s.settings, backgroundOpacity: clamped } }));
      applyBackgroundOpacity(clamped);
      void mage.setWindowOpacity(clamped).catch((err: unknown) => {
        // Sin material translucido el alfa mezcla contra el color de fondo en vez de contra el
        // escritorio: se ve distinto, pero la app no se rompe. Se traza y se sigue.
        console.warn('No se pudo ajustar el material de la ventana:', describeError(err));
      });
      deps.persistSettings();
    },

    // Añade (o reemplaza por id) y activa un tema ya mapeado; aplica al DOM y persiste. Sin red.
    applyImportedTheme: (imported) => {
      set((s) => ({
        settings: {
          ...s.settings,
          importedThemes: [...s.settings.importedThemes.filter((t) => t.id !== imported.id), imported],
          activeThemeId: imported.id,
        },
      }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      deps.persistSettings();
    },

    // Elimina un tema importado; si era el activo, vuelve al tema base.
    removeImportedTheme: (id) => {
      set((s) => ({
        settings: {
          ...s.settings,
          importedThemes: s.settings.importedThemes.filter((t) => t.id !== id),
          activeThemeId: s.settings.activeThemeId === id ? null : s.settings.activeThemeId,
        },
      }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      deps.persistSettings();
    },

    // Activa un tema importado (id) o vuelve al tema base (null).
    selectImportedTheme: (id) => {
      set((s) => ({ settings: { ...s.settings, activeThemeId: id } }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      deps.persistSettings();
    },

    // Activa/desactiva el widget: actualiza y persiste la preferencia, abre/cierra la ventana en main y,
    // al abrir, empuja un snapshot inmediato (evita widget en blanco hasta el proximo cambio de estado).
    setWidgetEnabled: (enabled) => {
      set((s) => ({ settings: { ...s.settings, widgetEnabled: enabled } }));
      deps.persistSettings();
      void mage.setWidgetEnabled(enabled).catch((err: unknown) =>
        console.warn('No se pudo cambiar el widget flotante:', describeError(err)),
      );
      if (enabled) deps.pushWidgetSnapshot();
    },

    // Fija (o borra) el modelo por defecto de un proveedor (F3). Guard clauses: sin proveedor no se hace
    // nada; con modelo vacio se QUITA la clave en vez de guardar '' (una cadena vacia en el mapa seria un
    // "configurado" que no configura nada, y obligaria a todos los consumidores a tratarla aparte).
    setDefaultModelForProvider: (providerId, model) => {
      const provider = providerId.trim();
      if (provider.length === 0) return;
      const value = model.trim();
      set((s) => {
        const next = { ...s.settings.defaultModelByProvider };
        if (value.length === 0) delete next[provider];
        else next[provider] = value;
        return { settings: { ...s.settings, defaultModelByProvider: next } };
      });
      deps.persistSettings();
    },

    // Fija/borra el override de un atajo (D5). Una accion tiene como mucho un override: se sustituye el
    // anterior en vez de acumular. `keys === null` borra el override (vuelve al default del catalogo).
    setKeybindingOverride: (actionId, keys) => {
      set((s) => {
        const withoutExisting = s.settings.keybindingOverrides.filter((o) => o.actionId !== actionId);
        const next = keys === null ? withoutExisting : [...withoutExisting, { actionId, keys }];
        return { settings: { ...s.settings, keybindingOverrides: next } };
      });
      deps.persistSettings();
    },

    resetAllKeybindings: () => {
      set((s) => ({ settings: { ...s.settings, keybindingOverrides: [] } }));
      deps.persistSettings();
    },

    // Anade o actualiza un proveedor del usuario (E2). Upsert por id EN SU SITIO (map en vez de
    // filter+push) para que editar uno no lo mande al final de la lista de Configuracion.
    saveCustomProvider: async (provider, apiKeyUpdate = { kind: 'keep' }) => {
      if (apiKeyUpdate.kind === 'set') await mage.setProviderApiKey({ providerId: provider.id, apiKey: apiKeyUpdate.value });
      if (apiKeyUpdate.kind === 'delete') await mage.deleteProviderApiKey(provider.id);
      set((s) => {
        const known = s.settings.customProviders.some((p) => p.id === provider.id);
        const customProviders = known
          ? s.settings.customProviders.map((p) => (p.id === provider.id ? provider : p))
          : [...s.settings.customProviders, provider];
        return { settings: { ...s.settings, customProviders } };
      });
      await deps.saveSettingsConfirmed();
    },

    // Elimina un proveedor y, con el, su modelo por defecto (F3): dejar la clave huerfana en
    // defaultModelByProvider haria que volver a crear un proveedor con el mismo id heredara ese modelo.
    removeCustomProvider: (id) => {
      // Y su clave, de la boveda de main: un proveedor recreado con el mismo id no hereda la del viejo.
      if (get().settings.customProviders.find((p) => p.id === id)?.hasApiKey === true) {
        void mage.deleteProviderApiKey(id).catch((err: unknown) => console.error(`No se pudo borrar la clave de ${id}:`, describeError(err)));
      }
      set((s) => {
        const defaultModelByProvider = { ...s.settings.defaultModelByProvider };
        delete defaultModelByProvider[id];
        // Y su ESFUERZO por defecto, que vive en el mismo mapa bajo `<id>#effort`. Por el mismo motivo
        // que el modelo: recrear un proveedor con el mismo id no debe heredar los ajustes del viejo.
        delete defaultModelByProvider[effortSettingKey(id)];
        return {
          settings: {
            ...s.settings,
            customProviders: s.settings.customProviders.filter((p) => p.id !== id),
            defaultModelByProvider,
          },
        };
      });
      deps.persistSettings();
    },
  };
}
