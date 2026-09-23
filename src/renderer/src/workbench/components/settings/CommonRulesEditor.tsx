import { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { useSharedConfigStore } from '../../sharedConfigStore';
import {
  parseCommonSettings,
  serializeCommonSettings,
  type HookDraft,
  type PermissionDraft,
  type PermissionEffect,
} from './sharedConfigModel';

// Editor por BLOQUES de la parte de Mage de hooks y permisos (`settings-common.json`). Sustituye al
// textarea de JSON crudo: aqui se añade, edita y quita una regla con campos, y el fichero en disco
// sigue siendo el mismo JSON que lee el CLI (lo serializa `sharedConfigModel`).
//
// Se monta en DOS sitios a proposito —"Config. compartida" y "Hooks y permisos"— porque es el mismo
// fichero: la segunda pantalla enseña ademas la union con las fuentes que Mage no puede tocar.

// Eventos del CLI, para el desplegable de sugerencias. NO es una lista cerrada (el campo es libre):
// si el CLI añade uno nuevo, escribirlo a mano tiene que seguir funcionando.
const HOOK_EVENTS: readonly string[] = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
];

const INPUT_CLASS =
  'min-w-0 rounded-[5px] border border-mg-border-subtle bg-mg-panel px-[7px] py-[3px] font-mono text-[11px] text-mg-body outline-none focus:border-mg-border-emph';

export function CommonRulesEditor(): React.JSX.Element {
  const snapshot = useSharedConfigStore((s) => s.snapshot);
  const save = useSharedConfigStore((s) => s.save);
  const saving = useSharedConfigStore((s) => s.savingByFile['settings-common']);
  const saveError = useSharedConfigStore((s) => s.saveErrorByFile['settings-common']);

  const text = snapshot?.settingsCommonText ?? '{}';
  const [hooks, setHooks] = useState<readonly HookDraft[]>([]);
  const [rules, setRules] = useState<readonly PermissionDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const parsed = parseCommonSettings(text);

  // Re-sincroniza con el fichero SOLO si el usuario no tiene cambios a medias: el snapshot se recarga
  // tambien al guardar el OTRO fichero comun, y pisar un borrador ajeno ahi seria perder trabajo.
  useEffect(() => {
    if (dirty) return;
    setHooks(parsed.hooks);
    setRules(parsed.permissions);
  }, [text]);

  const edit = (next: { hooks?: readonly HookDraft[]; rules?: readonly PermissionDraft[] }): void => {
    if (next.hooks !== undefined) setHooks(next.hooks);
    if (next.rules !== undefined) setRules(next.rules);
    setDirty(true);
    setWriteError(null);
  };

  const handleSave = (): void => {
    if (snapshot === null) return;
    let serialized: string;
    try {
      serialized = serializeCommonSettings(snapshot.settingsCommonText, hooks, rules);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
      return;
    }
    void save('settings-common', serialized, snapshot.settingsCommonBaseline).then((saved) => {
      if (!saved) return;
      // Se re-lee lo que quedo EN DISCO en vez de dar por buena la lista local: el serializador
      // descarta filas vacias, y si no se refresca la vista seguiria enseñando lo que no se guardo.
      // El efecto de arriba no sirve aqui: `dirty` sigue a true cuando llega el texto nuevo.
      const fresh = parseCommonSettings(useSharedConfigStore.getState().snapshot?.settingsCommonText ?? '{}');
      setHooks(fresh.hooks);
      setRules(fresh.permissions);
      setDirty(false);
    });
  };

  if (snapshot === null) return <p className="text-[11px] text-mg-muted">Cargando…</p>;

  return (
    <div className="flex flex-col gap-[12px]">
      {parsed.error !== null && (
        <div role="alert" className="rounded-[6px] border border-mg-danger-border bg-mg-danger-bg p-[7px_9px] text-[10.5px] text-mg-danger">
          El fichero <code>settings-common.json</code> no se pudo interpretar ({parsed.error}). Al guardar desde aquí se
          reescribirá con lo que muestre esta pantalla.
        </div>
      )}

      <PermissionRulesBlock rules={rules} onChange={(next) => edit({ rules: next })} />
      <HooksBlock hooks={hooks} onChange={(next) => edit({ hooks: next })} />

      <div className="flex items-center gap-[10px]">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-[6px] border border-mg-border-emph px-[10px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {dirty && <span className="text-[10.5px] text-mg-warn-text">Hay cambios sin guardar.</span>}
      </div>
      {writeError !== null && <div role="alert" className="text-[10.5px] text-mg-danger">{writeError}</div>}
      {saveError !== null && <div role="alert" className="text-[10.5px] text-mg-danger">No se pudo guardar: {saveError}</div>}
    </div>
  );
}

function PermissionRulesBlock({
  rules,
  onChange,
}: {
  readonly rules: readonly PermissionDraft[];
  readonly onChange: (next: readonly PermissionDraft[]) => void;
}): React.JSX.Element {
  const update = (index: number, patch: Partial<PermissionDraft>): void =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  return (
    <BlockShell
      title={`Reglas de permisos de Mage (${rules.length})`}
      hint="Se SUMAN a las de la cuenta y del proyecto. Ejemplos: Bash(git status), Read(~/.ssh/**), WebFetch."
      addLabel="Añadir regla"
      onAdd={() => onChange([...rules, { effect: 'allow', pattern: '' }])}
    >
      {rules.map((rule, index) => (
        <div key={index} className="flex items-center gap-[6px]">
          <EffectToggle effect={rule.effect} onChange={(effect) => update(index, { effect })} />
          <input
            value={rule.pattern}
            onChange={(e) => update(index, { pattern: e.target.value })}
            placeholder="Bash(git status:*)"
            aria-label={`Patrón de la regla ${index + 1}`}
            className={`${INPUT_CLASS} flex-1`}
          />
          <RemoveButton label={`Quitar la regla ${rule.pattern}`} onClick={() => onChange(rules.filter((_, i) => i !== index))} />
        </div>
      ))}
    </BlockShell>
  );
}

function HooksBlock({
  hooks,
  onChange,
}: {
  readonly hooks: readonly HookDraft[];
  readonly onChange: (next: readonly HookDraft[]) => void;
}): React.JSX.Element {
  const update = (index: number, patch: Partial<HookDraft>): void =>
    onChange(hooks.map((hook, i) => (i === index ? { ...hook, ...patch } : hook)));

  return (
    <BlockShell
      title={`Hooks de Mage (${hooks.length})`}
      hint="Comando que el CLI ejecuta en un evento. El filtro es opcional: vacío = todo el evento."
      addLabel="Añadir hook"
      onAdd={() => onChange([...hooks, { event: 'PreToolUse', matcher: null, command: '' }])}
    >
      <datalist id="common-hook-events">
        {HOOK_EVENTS.map((event) => (
          <option key={event} value={event} />
        ))}
      </datalist>
      {hooks.map((hook, index) => (
        <div key={index} className="flex items-center gap-[6px]">
          <input
            value={hook.event}
            list="common-hook-events"
            onChange={(e) => update(index, { event: e.target.value })}
            aria-label={`Evento del hook ${index + 1}`}
            className={`${INPUT_CLASS} w-[130px] flex-none`}
          />
          <input
            value={hook.matcher ?? ''}
            onChange={(e) => update(index, { matcher: e.target.value.length === 0 ? null : e.target.value })}
            placeholder="filtro (Bash, Edit…)"
            aria-label={`Filtro del hook ${index + 1}`}
            className={`${INPUT_CLASS} w-[120px] flex-none`}
          />
          <input
            value={hook.command}
            onChange={(e) => update(index, { command: e.target.value })}
            placeholder="comando a ejecutar"
            aria-label={`Comando del hook ${index + 1}`}
            className={`${INPUT_CLASS} flex-1`}
          />
          <RemoveButton label={`Quitar el hook ${hook.event}`} onClick={() => onChange(hooks.filter((_, i) => i !== index))} />
        </div>
      ))}
    </BlockShell>
  );
}

// Marco comun de un bloque editable: titulo, pista, filas y el boton de añadir al final (no arriba:
// la fila nueva aparece justo donde estaba el boton, sin que la vista salte).
export function BlockShell({
  title,
  hint,
  addLabel,
  onAdd,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly addLabel: string;
  readonly onAdd: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-[6px] rounded-[9px] border border-mg-border-ctrl bg-mg-block p-[10px]">
      <h3 className="text-[10px] font-bold uppercase tracking-[.07em] text-mg-ter">{title}</h3>
      <p className="text-[10px] leading-[1.5] text-mg-muted">{hint}</p>
      {children}
      <button
        onClick={onAdd}
        className="mt-[2px] flex w-fit items-center gap-[5px] rounded-[6px] border border-mg-border-emph px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        <Icon name="plus" size={11} /> {addLabel}
      </button>
    </section>
  );
}

export function RemoveButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      data-tip="Quitar"
      className="flex-none rounded-[5px] border border-mg-border-emph px-[6px] py-[3px] text-mg-body2 hover:border-mg-danger-border hover:bg-mg-danger-bg hover:text-mg-danger"
    >
      <Icon name="trash" size={11} />
    </button>
  );
}

function effectToggleClass(value: PermissionEffect, active: boolean): string {
  if (!active) return 'text-mg-muted hover:text-mg-body2';
  return value === 'deny' ? 'bg-mg-danger-bg text-mg-danger' : 'bg-mg-hover text-mg-body';
}

// Conmutador allow/deny. Dos botones en vez de un `<select>`: el nativo ya se descarto en este
// proyecto por incoherente con el resto de la UI (ver Dropdown.tsx), y aqui solo hay dos valores.
function EffectToggle({
  effect,
  onChange,
}: {
  readonly effect: PermissionEffect;
  readonly onChange: (effect: PermissionEffect) => void;
}): React.JSX.Element {
  return (
    <div role="group" aria-label="Efecto de la regla" className="flex flex-none overflow-hidden rounded-[5px] border border-mg-border-emph">
      {(['allow', 'deny'] as const).map((value) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          aria-pressed={effect === value}
          className={`px-[7px] py-[3px] text-[10px] font-semibold ${effectToggleClass(value, effect === value)}`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
