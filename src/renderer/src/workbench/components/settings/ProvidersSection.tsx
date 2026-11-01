import { useEffect, useState } from 'react';
import type { ProviderProbeResult } from '@shared/ipc';
import type { CustomProvider } from '@shared/providers';
import { formatToolAccessRules, parseToolAccessText } from '@shared/toolAccess';
import { AGY_PROVIDER_ID, PROVIDER_TEMPLATES, isAutoApprovedProvider } from '@shared/providers';
import { AgyProfileLinks } from './AgyProfileLinks';
import { useWorkbenchStore } from '../../workbenchStore';
import {
  EMPTY_CUSTOM_PROVIDER_DRAFT,
  applyRuntimeProbe,
  defaultEffortForProvider,
  draftFromProvider,
  runtimeProbeSummary,
  defaultModelForProvider,
  effortSettingKey,
  modelsToDraftText,
  probeErrorText,
  providerEntries,
  validateCustomProviderDraft,
  type ApiKeyUpdate,
  type CustomProviderDraft,
  type ModelOption,
  type ProviderEntry,
  type ToolsChoice,
} from '../../models';
import type { DefaultPermissionMode, RuntimeShell } from '@shared/settings';
import {
  defaultPermissionModeAccountLabel,
  defaultPermissionSteps,
  effortStepLabel,
  effortSteps,
  permissionModeLabel,
} from '../../stepSliderModel';
import { Dropdown } from '../Dropdown';
import { StepSlider } from '../StepSlider';
import { Icon } from '../Icon';
import { describeError } from '../../describeError';
import { renderLocalized } from '@shared/i18n/localizedText';
import { useT } from '../../../i18n/uiLanguage';

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
  const t = useT();

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
        {t('settings.providers.intro.start')} <strong>{t('settings.providers.intro.endpoint')}</strong>
        {t('settings.providers.intro.middle')} <strong>{t('settings.providers.intro.models')}</strong>{' '}
        {t('settings.providers.intro.end')}
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
          submitLabel={t('settings.providers.add')}
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

      <RuntimeShellPicker />

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
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      <button
        onClick={onBlank}
        className="rounded-[7px] border border-mg-border-emph px-[12px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
      >
        {t('settings.providers.addProvider')}
      </button>
      <span className="text-[11px] text-mg-ter">{t('settings.providers.templatesIntro')}</span>
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
  const t = useT();

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
        providerId={entry.id}
        draft={draft}
        savedApiKey={savedApiKey}
        error={editError}
        submitLabel={t('settings.providers.save')}
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
              {entry.kind === 'cli' ? t('settings.providers.kind.cli') : t('settings.providers.kind.http')}
            </span>
          </div>
          <EndpointLine entry={entry} probe={probe} />
        </div>
        <button
          onClick={runProbe}
          disabled={probe.loading}
          data-tip={t('settings.providers.recheck')}
          aria-label={t('settings.providers.recheckAria', { provider: entry.label })}
          className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50"
        >
          {probe.loading ? t('settings.providers.checking') : t('settings.providers.check')}
        </button>
        {entry.custom && (
          <>
            <button
              onClick={() =>
                setDraft(editDraftFor(entry, customProviders))
              }
              className="shrink-0 rounded-[7px] border border-mg-border-emph px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover"
            >
              {t('settings.providers.edit')}
            </button>
            <button
              onClick={onRemove}
              data-tip={t('settings.providers.removeTip')}
              aria-label={t('settings.providers.removeAria', { provider: entry.label })}
              className="shrink-0 text-[12px] text-mg-muted hover:text-mg-danger"
            >
              <Icon name="trash" size={12} />
            </button>
          </>
        )}
      </div>

      {isAutoApprovedProvider(entry.id) && (
        <div className="text-[10.5px] leading-[1.45] text-mg-warn">{t('prompt.providers.noPermissionControl')}</div>
      )}
      {entry.id === AGY_PROVIDER_ID && <AgyProfileLinks />}

      <ModelsLine count={models.length} probe={probe} />

      <div className="flex flex-wrap items-center gap-[10px]">
        <DefaultPicker
          label={t('settings.providers.defaultModel')}
          value={defaultModel}
          options={models.map((model) => ({ value: model.id, label: model.label }))}
          ariaLabel={t('settings.providers.defaultModelAria', { provider: entry.label })}
          onChange={onChangeModel}
        />
        {entry.effortLevels.length > 0 && (
          <div className="flex items-center gap-[6px] text-[11px] text-mg-sec">
            <span>{t('settings.providers.effort.label')}</span>
            <StepSlider
              steps={effortSteps(entry.effortLevels)}
              value={defaultEffort}
              onChange={onChangeEffort}
              ariaLabel={t('settings.providers.effort.aria', { provider: entry.label })}
              chipLabel={effortStepLabel(defaultEffort)}
              chipSizers={effortSteps(entry.effortLevels).map((step) => step.label)}
              heading={t('settings.providers.effort.heading', { level: effortStepLabel(defaultEffort) })}
              endLabels={[t('settings.providers.effort.faster'), t('settings.providers.effort.smarter')]}
              tip={t('settings.providers.effort.tip')}
            />
          </div>
        )}
        {entry.id === 'claude' && <DefaultPermissionModePicker />}
      </div>
      {entry.custom && <ToolAccessEditor providerId={entry.id} label={entry.label} />}
    </div>
  );
}

// Acceso a herramientas por modelo de un proveedor del runtime propio (P-032, §8.1 D10). Se guarda al
// salir del campo; las lineas que no se entienden se dicen y no se guardan.
function ToolAccessEditor({ providerId, label }: { readonly providerId: string; readonly label: string }): React.JSX.Element {
  const saved = useWorkbenchStore((s) => s.settings.runtimeToolAccess[providerId]);
  const setAccess = useWorkbenchStore((s) => s.setRuntimeToolAccess);
  const [text, setText] = useState(() => formatToolAccessRules(saved ?? []));
  const [errors, setErrors] = useState<readonly string[]>([]);
  const t = useT();
  const save = (): void => {
    const parsed = parseToolAccessText(text);
    setErrors(parsed.errors.map((error) => renderLocalized(t, error)));
    if (parsed.errors.length === 0) setAccess(providerId, parsed.rules);
  };
  return (
    <div className="flex flex-col gap-[4px]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        rows={2}
        placeholder={`${t('settings.providers.toolAccess.placeholder')}\n*: -Bash\nqwen2.5-coder: Read, Glob`}
        aria-label={t('settings.providers.toolAccess.aria', { provider: label })}
        data-tip={t('settings.providers.toolAccess.tip')}
        className="w-full rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[4px] font-mono text-[11px] text-mg-body outline-none placeholder:text-mg-muted"
      />
      {errors.map((error) => (
        <div key={error} role="alert" className="text-[10.5px] text-mg-danger">
          {error}
        </div>
      ))}
    </div>
  );
}

// Shell con la que los proveedores del usuario (runtime propio de Mage, P-032) ejecutan comandos. Bash y
// PowerShell son nombres de producto; la opcion automatica se traduce al pintar.
function RuntimeShellPicker(): React.JSX.Element {
  const shell = useWorkbenchStore((s) => s.settings.runtimeShell);
  const setShell = useWorkbenchStore((s) => s.setRuntimeShell);
  const t = useT();
  const options = [
    { value: 'auto', label: t('settings.providers.shell.auto') },
    { value: 'bash', label: 'Bash' },
    { value: 'powershell', label: 'PowerShell' },
  ];
  return (
    <div className="flex items-center gap-[6px] text-[11px] text-mg-sec" data-testid="runtime-shell">
      <span>{t('settings.providers.shell.label')}</span>
      <Dropdown
        value={shell}
        options={options}
        onChange={(value) => setShell(value as RuntimeShell)}
        ariaLabel={t('settings.providers.shell.aria')}
        tip={t('settings.providers.shell.tip')}
        triggerClassName="w-[210px]"
      />
    </div>
  );
}

// Modo de permiso con el que arrancan las conversaciones nuevas de Claude (P-028 6). El deslizador del chat
// con una posicion delante: «De la cuenta» (adopta el del CLI). «Omitir permisos» se ofrece desde la 0.1.1
// R2 (punto 6) con una linea de aviso fija mientras este elegido.
function DefaultPermissionModePicker(): React.JSX.Element {
  const mode = useWorkbenchStore((s) => s.settings.defaultPermissionMode);
  const setMode = useWorkbenchStore((s) => s.setDefaultPermissionMode);
  const t = useT();
  const label = mode === '' ? defaultPermissionModeAccountLabel() : permissionModeLabel(mode);
  return (
    <div className="flex flex-col gap-[4px]">
      <DefaultPermissionModeSlider mode={mode} label={label} onChange={setMode} />
      {/* Linea fija mientras «Omitir permisos» es el defecto (0.1.1 R2, punto 6). */}
      {mode === 'bypassPermissions' && (
        <div role="note" data-testid="default-bypass-warning" className="text-[10.5px] font-semibold text-mg-danger">
          {t('settings.providers.permission.bypassWarning')}
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
  const t = useT();
  return (
    <div className="flex items-center gap-[6px] text-[11px] text-mg-sec">
      <span>{t('settings.providers.permission.label')}</span>
      <StepSlider
        steps={defaultPermissionSteps}
        value={mode}
        onChange={(next) => onChange(next as DefaultPermissionMode)}
        ariaLabel={t('settings.providers.permission.aria')}
        chipLabel={label}
        chipSizers={defaultPermissionSteps.map((step) => step.label)}
        heading={t('settings.providers.permission.heading', { mode: label })}
        endLabels={[t('settings.providers.permission.moreControl'), t('settings.providers.permission.moreAutonomy')]}
        tip={t('settings.providers.permission.tip')}
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
  const t = useT();
  return (
    <div className="flex items-center gap-[6px] text-[11px] text-mg-sec">
      <span>{label}</span>
      <Dropdown
        value={value}
        options={[{ value: '', label: t('settings.providers.automatic') }, ...options]}
        onChange={onChange}
        ariaLabel={ariaLabel}
        triggerClassName="w-[210px]"
      />
    </div>
  );
}

// A donde apunta: ruta del ejecutable detectada o URL consultada. Si el sondeo no la encontro, se dice
// con todas las letras en vez de dejar el hueco vacio.
// data-volatile-text: la ruta real del ejecutable o «Localizando…», según el momento.
function EndpointLine({ entry, probe }: { readonly entry: ProviderEntry; readonly probe: ProbeState }): React.JSX.Element {
  const t = useT();
  const fallback = entry.baseUrl ?? (probe.loading ? t('settings.providers.endpoint.locating') : t('settings.providers.endpoint.noPath'));
  const endpoint = probe.result?.endpoint ?? fallback;
  const notFound = !probe.loading && probe.result !== null && probe.result.endpoint === null;
  return (
    <div className={`truncate font-mono text-[10.5px] ${notFound ? 'text-mg-danger' : 'text-mg-ter'}`} title={endpoint} data-volatile-text="true">
      {notFound ? t('settings.providers.endpoint.notFound') : endpoint}
    </div>
  );
}

// Que se pudo saber del catalogo. Tres estados distintos y ninguno se disfraza de otro: sondeando,
// sondeado (cuantos modelos) o no se pudo listar (con el motivo exacto que dio el proveedor).
function ModelsLine({ count, probe }: { readonly count: number; readonly probe: ProbeState }): React.JSX.Element {
  const t = useT();
  if (probe.loading) return <div className="text-[10.5px] text-mg-muted">{t('settings.providers.models.loading')}</div>;
  if (probe.failure !== null) {
    return (
      <div role="alert" className="text-[10.5px] text-mg-danger">
        {t('settings.providers.models.failure', { error: probe.failure })}
      </div>
    );
  }
  const reason = probeErrorText(probe.result?.error ?? null);
  const listed = probe.result?.models !== null && probe.result?.models !== undefined;
  return (
    <div className="text-[10.5px] leading-[1.45] text-mg-muted">
      {listed ? t('settings.providers.models.offered', { count }) : t('settings.providers.models.declared', { count })}
      {reason !== null && <span className={listed ? '' : ' text-mg-warn'}> {reason}</span>}
    </div>
  );
}

// Formulario de alta/edicion de un proveedor del usuario. La API key va en type="password" y sube a la
// boveda cifrada de main al guardar; la guardada NO vuelve nunca, asi que al editar el campo sale vacio
// y solo se dice que hay una (escribir otra la sustituye; la casilla la quita).
// La etiqueta es la CLAVE del catalogo: se traduce al pintar.
const TOOLS_OPTIONS = [
  { value: 'auto', label: 'settings.providers.tools.auto' },
  { value: 'yes', label: 'settings.providers.tools.yes' },
  { value: 'no', label: 'settings.providers.tools.no' },
] as const;
// URL de ejemplo del placeholder: no se traduce.
const BASE_URL_EXAMPLE = 'http://localhost:11434/v1';

export function ProviderForm({
  idSuffix,
  providerId = null,
  draft,
  savedApiKey,
  error,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly idSuffix: string;
  // Id del proveedor ya guardado (su clave sale de la boveda al probar); null = uno nuevo.
  readonly providerId?: string | null;
  readonly draft: CustomProviderDraft;
  readonly savedApiKey: boolean;
  readonly error: string | null;
  readonly submitLabel: string;
  readonly onChange: (changes: Partial<CustomProviderDraft>) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const errorId = `provider-error-${idSuffix}`;
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const t = useT();
  // «Probar conexión» (P-032 R7): pide a main los modelos, la ventana y las herramientas del servidor.
  const testConnection = (): void => {
    setTesting(true);
    setTestStatus(null);
    window.mage
      .probeRuntime({ providerId, baseUrl: draft.baseUrl })
      .then((result) => {
        setTestStatus(probeErrorText(result.error) ?? runtimeProbeSummary(result));
        if (result.error === null) onChange(applyRuntimeProbe(draft, result));
      })
      .catch((err: unknown) => setTestStatus(describeError(err)))
      .finally(() => setTesting(false));
  };
  const inputClass =
    'w-full rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[4px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted';

  return (
    <div className="flex flex-col gap-[6px] rounded-[9px] border border-mg-border-ctrl bg-mg-code p-[10px]">
      <input
        value={draft.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder={t('settings.providers.form.namePlaceholder')}
        aria-label={t('settings.providers.form.nameAria')}
        className={inputClass}
      />
      <input
        value={draft.baseUrl}
        onChange={(e) => onChange({ baseUrl: e.target.value })}
        placeholder={t('settings.providers.form.urlPlaceholder', { example: BASE_URL_EXAMPLE })}
        aria-label={t('settings.providers.form.urlAria')}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className={`${inputClass} font-mono`}
      />
      <input
        value={draft.models}
        onChange={(e) => onChange({ models: e.target.value })}
        placeholder={t('settings.providers.form.modelsPlaceholder')}
        aria-label={t('settings.providers.form.modelsAria')}
        className={`${inputClass} font-mono`}
      />
      <div className="flex items-center gap-[6px]">
        <input
          value={draft.contextWindow}
          onChange={(e) => onChange({ contextWindow: e.target.value })}
          placeholder={t('settings.providers.form.contextPlaceholder')}
          aria-label={t('settings.providers.form.contextAria')}
          inputMode="numeric"
          className={`${inputClass} font-mono`}
        />
        <Dropdown
          value={draft.supportsTools}
          options={TOOLS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
          onChange={(value) => onChange({ supportsTools: value as ToolsChoice })}
          ariaLabel={t('settings.providers.form.toolsAria')}
          tip={t('settings.providers.form.toolsTip')}
          triggerClassName="w-[190px]"
        />
      </div>
      <input
        type="password"
        value={draft.apiKey}
        onChange={(e) => onChange({ apiKey: e.target.value })}
        placeholder={savedApiKey ? t('settings.providers.form.savedKeyPlaceholder') : t('settings.providers.form.apiKeyPlaceholder')}
        aria-label={t('settings.providers.form.apiKeyAria')}
        autoComplete="off"
        className={inputClass}
      />
      {savedApiKey && (
        <label className="flex items-center gap-[6px] text-[11px] text-mg-sec">
          <input type="checkbox" checked={draft.forgetApiKey} onChange={(e) => onChange({ forgetApiKey: e.target.checked })} />
          {t('settings.providers.form.forgetKey')}
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
          {t('settings.providers.form.cancel')}
        </button>
        <button
          onClick={testConnection}
          disabled={testing || draft.baseUrl.trim().length === 0}
          data-runtime-probe="true"
          className="ml-auto rounded-[7px] border border-mg-border-subtle px-[10px] py-[4px] text-[11.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50"
        >
          {testing ? t('settings.providers.form.testing') : t('settings.providers.form.test')}
        </button>
      </div>
      {testStatus !== null && (
        <div role="status" data-runtime-probe-status="true" className="text-[10.5px] leading-[1.45] text-mg-sec">
          {testStatus}
        </div>
      )}
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

// ¿Tiene clave en la boveda? Solo los del usuario: los de serie la leen del entorno de main.
function hasSavedApiKey(entry: ProviderEntry, customProviders: readonly CustomProvider[]): boolean {
  if (!entry.custom) return false;
  return customProviders.find((provider) => provider.id === entry.id)?.hasApiKey ?? false;
}

// El borrador de edicion: el proveedor guardado (con su ventana y sus herramientas) si existe.
function editDraftFor(entry: ProviderEntry, customProviders: readonly CustomProvider[]): CustomProviderDraft {
  const saved = customProviders.find((provider) => provider.id === entry.id);
  if (saved !== undefined) return draftFromProvider(saved);
  return { ...EMPTY_CUSTOM_PROVIDER_DRAFT, label: entry.label, baseUrl: entry.baseUrl ?? '', models: modelsToDraftText(entry.models) };
}
