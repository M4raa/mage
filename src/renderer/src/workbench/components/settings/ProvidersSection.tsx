import { useEffect, useState } from 'react';
import type { ProviderProbeResult } from '@shared/ipc';
import type { CustomProvider } from '@shared/providers';
import { AGY_PROVIDER_ID, NO_PERMISSION_CONTROL_WARNING, PROVIDER_TEMPLATES, isAutoApprovedProvider } from '@shared/providers';
import { AgyProfileLinks } from './AgyProfileLinks';
import { useWorkbenchStore } from '../../workbenchStore';
import {
  EMPTY_CUSTOM_PROVIDER_DRAFT,
  defaultEffortForProvider,
  defaultModelForProvider,
  effortSettingKey,
  modelsToDraftText,
  providerEntries,
  validateCustomProviderDraft,
  type ApiKeyUpdate,
  type CustomProviderDraft,
  type ModelOption,
  type ProviderEntry,
} from '../../models';
import type { DefaultPermissionMode } from '@shared/settings';
import {
  DEFAULT_PERMISSION_MODE_ACCOUNT_LABEL,
  EFFORT_STEP_LABEL,
  defaultPermissionSteps,
  effortSteps,
  permissionModeLabel,
} from '../../stepSliderModel';
import { Dropdown } from '../Dropdown';
import { StepSlider } from '../StepSlider';
import { Icon } from '../Icon';

// Seccion UNICA "Proveedores y modelos" (D2). Antes eran dos: "Proveedores" (alta de endpoints
// compatibles con OpenAI) y "Modelos" (modelo por defecto), que listaba proveedores definidos en la
// otra. Ahora cada proveedor —de serie o del usuario— es UNA ficha con todo lo suyo:
//   1. a donde apunta: la ruta del ejecutable detectada (CLI) o la URL del endpoint (HTTP);
//   2. los modelos que ofrece DE VERDAD, sondeados; si no se pueden preguntar, se dice y punto;
//   3. modelo y esfuerzo por defecto, con "Automático" = reutilizar el ultimo usado.
export function ProvidersSection(): React.JSX.Element {
  const customProviders = useWorkbenchStore((s) => s.settings.customProviders);
  const defaults = useWorkbenchStore((s) => s.settings.defaultModelByProvider);
  const setDefault = useWorkbenchStore((s) => s.setDefaultModelForProvider);
  const saveProvider = useWorkbenchStore((s) => s.saveCustomProvider);
  const removeProvider = useWorkbenchStore((s) => s.removeCustomProvider);
  const [newDraft, setNewDraft] = useState<CustomProviderDraft | null>(null);
  const [newError, setNewError] = useState<string | null>(null);

  const submitNew = (): void => {
    if (newDraft === null) return;
    const result = validateCustomProviderDraft(newDraft, customProviders, null);
    if (!result.ok) {
      setNewError(result.message);
      return;
    }
    saveProvider(result.provider, result.apiKeyUpdate)
      .then(() => {
        setNewDraft(null);
        setNewError(null);
      })
      .catch((err: unknown) => setNewError(describeError(err)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        Cada proveedor con <strong>a dónde apunta</strong>, los <strong>modelos que ofrece</strong> y con
        qué arranca una conversación nueva. Mage localiza solo los CLI instalados y pregunta el catálogo
        a cada proveedor; «Automático» significa reutilizar el último valor que usaste.
      </p>

      {providerEntries(customProviders).map((entry) => (
        <ProviderCard
          key={entry.id}
          entry={entry}
          defaultModel={defaultModelForProvider(defaults, entry.id)}
          defaultEffort={defaultEffortForProvider(defaults, entry.id)}
          onChangeModel={(model) => setDefault(entry.id, model)}
          onChangeEffort={(effort) => setDefault(effortSettingKey(entry.id), effort)}
          onSaveEdit={saveProvider}
          onRemove={() => removeProvider(entry.id)}
          customProviders={customProviders}
        />
      ))}

      {newDraft !== null && (
        <ProviderForm
          idSuffix="nuevo"
          draft={newDraft}
          savedApiKey={false}
          error={newError}
          submitLabel="Añadir"
          onChange={(changes) => {
            setNewDraft({ ...newDraft, ...changes });
            setNewError(null);
          }}
          onSubmit={submitNew}
          onCancel={() => {
            setNewDraft(null);
            setNewError(null);
          }}
        />
      )}

      {newDraft === null && (
        <AddProviderBar
          onBlank={() => {
            setNewError(null);
            setNewDraft(EMPTY_CUSTOM_PROVIDER_DRAFT);
          }}
          onTemplate={(label, baseUrl, modelIds) => {
            setNewError(null);
            setNewDraft({ ...EMPTY_CUSTOM_PROVIDER_DRAFT, label, baseUrl, models: modelIds.join(', ') });
          }}
        />
      )}
    </div>
  );
}

// Botonera de alta: en blanco o desde una plantilla (Ollama, LM Studio). Las plantillas solo
// PRERRELLENAN el formulario: Mage no asume ningun runtime local instalado.
function AddProviderBar({
  onBlank,
  onTemplate,
}: {
  readonly onBlank: () => void;
  readonly onTemplate: (label: string, baseUrl: string, modelIds: readonly string[]) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      <button
        onClick={onBlank}
        className="rounded-[7px] border border-mg-border-emph px-[12px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
      >
        ＋ Añadir proveedor
      </button>
      <span className="text-[11px] text-mg-ter">o empieza por una plantilla:</span>
      {PROVIDER_TEMPLATES.map((template) => (
        <button
          key={template.label}
          onClick={() => onTemplate(template.label, template.baseUrl, template.modelIds)}
          data-tip={template.baseUrl}
          className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[5px] text-[11.5px] text-mg-sec hover:bg-mg-hover hover:text-mg-body"
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}

interface ProbeState {
  readonly loading: boolean;
  readonly result: ProviderProbeResult | null;
  readonly failure: string | null; // el sondeo en si no pudo ni ejecutarse (IPC)
}

const IDLE_PROBE: ProbeState = { loading: true, result: null, failure: null };

// Ficha de un proveedor. Sondea al montarse (que es cuando el usuario abre la seccion) y deja
// reintentar: instalar un CLI o arrancar Ollama con Mage abierto tiene que poder verse sin reiniciar.
function ProviderCard({
  entry,
  defaultModel,
  defaultEffort,
  onChangeModel,
  onChangeEffort,
  onSaveEdit,
  onRemove,
  customProviders,
}: {
  readonly entry: ProviderEntry;
  readonly defaultModel: string;
  readonly defaultEffort: string;
  readonly onChangeModel: (model: string) => void;
  readonly onChangeEffort: (effort: string) => void;
  readonly onSaveEdit: (provider: CustomProvider, apiKeyUpdate: ApiKeyUpdate) => Promise<void>;
  readonly onRemove: () => void;
  readonly customProviders: readonly CustomProvider[];
}): React.JSX.Element | null {
  const [probe, setProbe] = useState<ProbeState>(IDLE_PROBE);
  const [draft, setDraft] = useState<CustomProviderDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const runProbe = (): void => {
    setProbe({ loading: true, result: null, failure: null });
    window.mage
      .probeProvider({ providerId: entry.id, baseUrl: entry.baseUrl })
      .then((result) => setProbe({ loading: false, result, failure: null }))
      .catch((err: unknown) => setProbe({ loading: false, result: null, failure: describeError(err) }));
  };

  // Se re-sondea cuando cambia la URL del proveedor (editarla es justo el momento de comprobarla). Las
  // deps son a proposito ESAS dos: `entry` se reconstruye en cada render (providerEntries mapea) y
  // `customProviders` cambia al teclear cualquier otra ficha, asi que incluirlos sondearia sin parar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(runProbe, [entry.id, entry.baseUrl]);

  const models = offeredModels(entry, probe.result);

  // SOLO SE LISTA LO QUE SE PUEDE USAR (peticion del usuario, 2026-09-18): un proveedor de serie que no
  // esta ni instalado ni configurado no aparece. La regla es UNA y sirve para los dos tipos, sin casos
  // especiales: si el sondeo no encontro A DONDE APUNTAR (`endpoint === null`), no hay nada que
  // ofrecer — para un CLI significa "el binario no esta", y para una API de serie "no hay clave".
  // Los del USUARIO no se ocultan nunca: los dio de alta a proposito y esconderselos porque su
  // servidor local este apagado seria perder su configuracion de vista.
  // Mientras el sondeo esta en vuelo no se decide nada: ocultar y reaparecer daria un parpadeo.
  const noDisponible = !entry.custom && !probe.loading && (probe.result?.endpoint ?? null) === null;
  if (noDisponible) return null;

  const submitEdit = (): void => {
    if (draft === null) return;
    const result = validateCustomProviderDraft(draft, customProviders, entry.id);
    if (!result.ok) {
      setEditError(result.message);
      return;
    }
    onSaveEdit(result.provider, result.apiKeyUpdate)
      .then(() => {
        setDraft(null);
        setEditError(null);
      })
      .catch((err: unknown) => setEditError(describeError(err)));
  };
  const savedApiKey = hasSavedApiKey(entry, customProviders);

  if (draft !== null) {
    return (
      <ProviderForm
        idSuffix={entry.id}
        draft={draft}
        savedApiKey={savedApiKey}
        error={editError}
        submitLabel="Guardar"
        onChange={(changes) => {
          setDraft({ ...draft, ...changes });
          setEditError(null);
        }}
        onSubmit={submitEdit}
        onCancel={() => {
          setDraft(null);
          setEditError(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[8px] rounded-[9px] border border-mg-border-ctrl bg-mg-code p-[10px]">
      <div className="flex items-start gap-[8px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[6px] text-[11.5px] text-mg-body">
            <span className="truncate font-semibold">{entry.label}</span>
            <span className="shrink-0 rounded-[4px] border border-mg-border-subtle px-[5px] py-[1px] text-[9.5px] text-mg-ter">
              {entry.kind === 'cli' ? 'CLI local' : 'API compatible con OpenAI'}
            </span>
          </div>
          <EndpointLine entry={entry} probe={probe} />
        </div>
        <button
          onClick={runProbe}
          disabled={probe.loading}
          data-tip="Volver a comprobar"
          aria-label={`Volver a comprobar ${entry.label}`}
          className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50"
        >
          {probe.loading ? 'Comprobando…' : 'Comprobar'}
        </button>
        {entry.custom && (
          <>
            <button
              onClick={() =>
                setDraft({
                  ...EMPTY_CUSTOM_PROVIDER_DRAFT,
                  label: entry.label,
                  baseUrl: entry.baseUrl ?? '',
                  models: modelsToDraftText(entry.models),
                })
              }
              className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover"
            >
              Editar
            </button>
            <button
              onClick={onRemove}
              data-tip="Eliminar proveedor"
              aria-label={`Eliminar el proveedor ${entry.label}`}
              className="shrink-0 text-[12px] text-mg-muted hover:text-mg-danger"
            >
              <Icon name="trash" size={12} />
            </button>
          </>
        )}
      </div>

      {isAutoApprovedProvider(entry.id) && (
        <div className="text-[10.5px] leading-[1.45] text-mg-warn">{NO_PERMISSION_CONTROL_WARNING}</div>
      )}
      {entry.id === AGY_PROVIDER_ID && <AgyProfileLinks />}

      <ModelsLine count={models.length} probe={probe} />

      <div className="flex flex-wrap items-center gap-[10px]">
        <DefaultPicker
          label="Modelo por defecto"
          value={defaultModel}
          options={models.map((model) => ({ value: model.id, label: model.label }))}
          ariaLabel={`Modelo por defecto de ${entry.label}`}
          onChange={onChangeModel}
        />
        {entry.effortLevels.length > 0 && (
          <div className="flex items-center gap-[6px] text-[11px] text-mg-sec">
            <span>Esfuerzo</span>
            <StepSlider
              steps={effortSteps(entry.effortLevels)}
              value={defaultEffort}
              onChange={onChangeEffort}
              ariaLabel={`Esfuerzo por defecto de ${entry.label}`}
              chipLabel={EFFORT_STEP_LABEL[defaultEffort] ?? defaultEffort}
              chipSizers={effortSteps(entry.effortLevels).map((step) => step.label)}
              heading={`Esfuerzo ${EFFORT_STEP_LABEL[defaultEffort] ?? defaultEffort}`}
              endLabels={['Más rápido', 'Más inteligente']}
              tip="Esfuerzo con el que arrancan las conversaciones nuevas. Auto = el último usado o el del CLI."
            />
          </div>
        )}
        {entry.id === 'claude' && <DefaultPermissionModePicker />}
      </div>
    </div>
  );
}

// Linea fija mientras «Omitir permisos» es el defecto (0.1.1 R2, punto 6).
export const DEFAULT_BYPASS_WARNING = 'Las conversaciones nuevas ejecutarán todo sin preguntar';

// Modo de permiso con el que arrancan las conversaciones nuevas de Claude (P-028 6). El deslizador del chat
// con una posicion delante: «De la cuenta» (adopta el del CLI). «Omitir permisos» se ofrece desde la 0.1.1
// R2 (punto 6) con una linea de aviso fija mientras este elegido.
function DefaultPermissionModePicker(): React.JSX.Element {
  const mode = useWorkbenchStore((s) => s.settings.defaultPermissionMode);
  const setMode = useWorkbenchStore((s) => s.setDefaultPermissionMode);
  const label = mode === '' ? DEFAULT_PERMISSION_MODE_ACCOUNT_LABEL : permissionModeLabel(mode);
  return (
    <div className="flex flex-col gap-[4px]">
      <DefaultPermissionModeSlider mode={mode} label={label} onChange={setMode} />
      {mode === 'bypassPermissions' && (
        <div role="note" data-testid="default-bypass-warning" className="text-[10.5px] font-semibold text-mg-danger">
          {DEFAULT_BYPASS_WARNING}
        </div>
      )}
    </div>
  );
}

function DefaultPermissionModeSlider({
  mode,
  label,
  onChange,
}: {
  readonly mode: DefaultPermissionMode;
  readonly label: string;
  readonly onChange: (mode: DefaultPermissionMode) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[6px] text-[11px] text-mg-sec">
      <span>Modo de permiso</span>
      <StepSlider
        steps={defaultPermissionSteps}
        value={mode}
        onChange={(next) => onChange(next as DefaultPermissionMode)}
        ariaLabel="Modo de permiso por defecto"
        chipLabel={label}
        chipSizers={defaultPermissionSteps.map((step) => step.label)}
        heading={`Modo ${label}`}
        endLabels={['Más control', 'Más autonomía']}
        tip="Modo con el que arrancan las conversaciones nuevas. «De la cuenta» adopta el del CLI."
      />
    </div>
  );
}

// Un desplegable con su etiqueta. "Automático" es SIEMPRE la primera opcion y vale '': la conversacion
// nueva reutiliza el ultimo valor usado y, si no hay ninguno, el que decida el proveedor.
function DefaultPicker({
  label,
  value,
  options,
  ariaLabel,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly ariaLabel: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[6px] text-[11px] text-mg-sec">
      <span>{label}</span>
      <Dropdown
        value={value}
        options={[{ value: '', label: 'Automático' }, ...options]}
        onChange={onChange}
        ariaLabel={ariaLabel}
        triggerClassName="w-[210px]"
      />
    </div>
  );
}

// A donde apunta: ruta del ejecutable detectada o URL consultada. Si el sondeo no la encontro, se dice
// con todas las letras en vez de dejar el hueco vacio.
function EndpointLine({ entry, probe }: { readonly entry: ProviderEntry; readonly probe: ProbeState }): React.JSX.Element {
  const fallback = entry.baseUrl ?? (probe.loading ? 'Localizando el ejecutable…' : 'sin ruta');
  const endpoint = probe.result?.endpoint ?? fallback;
  const notFound = !probe.loading && probe.result !== null && probe.result.endpoint === null;
  return (
    <div className={`truncate font-mono text-[10.5px] ${notFound ? 'text-mg-danger' : 'text-mg-ter'}`} title={endpoint}>
      {notFound ? 'No encontrado' : endpoint}
    </div>
  );
}

// Que se pudo saber del catalogo. Tres estados distintos y ninguno se disfraza de otro: sondeando,
// sondeado (cuantos modelos) o no se pudo listar (con el motivo exacto que dio el proveedor).
function ModelsLine({ count, probe }: { readonly count: number; readonly probe: ProbeState }): React.JSX.Element {
  if (probe.loading) return <div className="text-[10.5px] text-mg-muted">Consultando los modelos disponibles…</div>;
  if (probe.failure !== null) {
    return (
      <div role="alert" className="text-[10.5px] text-mg-danger">
        No se pudo listar: {probe.failure}
      </div>
    );
  }
  const reason = probe.result?.error ?? null;
  const listed = probe.result?.models !== null && probe.result?.models !== undefined;
  return (
    <div className="text-[10.5px] leading-[1.45] text-mg-muted">
      {listed ? `${count} modelo${count === 1 ? '' : 's'} ofrecidos por el proveedor.` : `${count} modelo${count === 1 ? '' : 's'} en la lista de Mage.`}
      {reason !== null && <span className={listed ? '' : ' text-mg-warn'}> {reason}</span>}
    </div>
  );
}

// Formulario de alta/edicion de un proveedor del usuario. La API key va en type="password" y sube a la
// boveda cifrada de main al guardar; la guardada NO vuelve nunca, asi que al editar el campo sale vacio
// y solo se dice que hay una (escribir otra la sustituye; la casilla la quita).
export function ProviderForm({
  idSuffix,
  draft,
  savedApiKey,
  error,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly idSuffix: string;
  readonly draft: CustomProviderDraft;
  readonly savedApiKey: boolean;
  readonly error: string | null;
  readonly submitLabel: string;
  readonly onChange: (changes: Partial<CustomProviderDraft>) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const errorId = `provider-error-${idSuffix}`;
  const inputClass =
    'w-full rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[4px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted';

  return (
    <div className="flex flex-col gap-[6px] rounded-[9px] border border-mg-border-ctrl bg-mg-code p-[10px]">
      <input
        value={draft.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Nombre, p. ej. Ollama del portátil"
        aria-label="Nombre del proveedor"
        className={inputClass}
      />
      <input
        value={draft.baseUrl}
        onChange={(e) => onChange({ baseUrl: e.target.value })}
        placeholder="URL base, p. ej. http://localhost:11434/v1"
        aria-label="URL base del endpoint compatible con la API de OpenAI"
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className={`${inputClass} font-mono`}
      />
      <input
        value={draft.models}
        onChange={(e) => onChange({ models: e.target.value })}
        placeholder="Modelos separados por comas, p. ej. llama3, mistral"
        aria-label="Modelos del proveedor, separados por comas"
        className={`${inputClass} font-mono`}
      />
      <input
        type="password"
        value={draft.apiKey}
        onChange={(e) => onChange({ apiKey: e.target.value })}
        placeholder={savedApiKey ? SAVED_API_KEY_PLACEHOLDER : 'API key (opcional; los runtimes locales no la piden)'}
        aria-label="API key del proveedor (opcional)"
        autoComplete="off"
        className={inputClass}
      />
      {savedApiKey && (
        <label className="flex items-center gap-[6px] text-[11px] text-mg-sec">
          <input type="checkbox" checked={draft.forgetApiKey} onChange={(e) => onChange({ forgetApiKey: e.target.checked })} />
          Quitar la clave guardada
        </label>
      )}
      {error !== null && (
        <div id={errorId} role="alert" className="text-[10.5px] text-mg-danger">
          {error}
        </div>
      )}
      <div className="flex items-center gap-[6px]">
        <button
          onClick={onSubmit}
          className="rounded-[7px] border border-mg-border-emph px-[12px] py-[4px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
        >
          {submitLabel}
        </button>
        <button onClick={onCancel} className="rounded-[7px] px-[10px] py-[4px] text-[11.5px] text-mg-sec hover:bg-mg-hover">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// Modelos a ofrecer en el selector: los SONDEADOS si el proveedor supo decirlos; si no, los que declara
// Mage. Nunca se mezclan las dos listas: mezclarlas presentaria como disponible un modelo que el
// proveedor acaba de decir que no tiene.
function offeredModels(entry: ProviderEntry, result: ProviderProbeResult | null): readonly ModelOption[] {
  const probed = result?.models ?? null;
  return probed === null || probed.length === 0 ? entry.models : probed;
}

export const SAVED_API_KEY_PLACEHOLDER = 'Clave guardada y cifrada · escribe otra para sustituirla';

// ¿Tiene clave en la boveda? Solo los del usuario: los de serie la leen del entorno de main.
function hasSavedApiKey(entry: ProviderEntry, customProviders: readonly CustomProvider[]): boolean {
  if (!entry.custom) return false;
  return customProviders.find((provider) => provider.id === entry.id)?.hasApiKey ?? false;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
