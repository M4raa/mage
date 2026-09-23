import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { EFFORT_LEVELS } from '@shared/ipc';
import type { EditorInfo } from '@shared/ipc';
import { NO_PERMISSION_CONTROL_WARNING, isAutoApprovedProvider } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { modelOptionsForProvider } from '../models';
import { continueListOnNewline, indentLines, outdentLines, type TextState } from '../promptEditing';
import { enterAction } from '../promptEnter';
import { validateAttachmentSet } from '@shared/attachments';
import type { PromptEditorHandle } from './PromptEditor';
import { Icon, type IconName } from './Icon';
import type { ImageAttachment, PendingAttachment, PromptDraft } from '../types';
import { buildSlashCatalog, completionFor, filterSlashCommands, type SlashCommand } from '../slashCommands';
import { useCachedCommandCatalog } from '../commandCatalogStore';
import { resolveKeyEvent } from '../keybindings/resolver';
import { isMacPlatform } from '../keybindings/platform';
import { effortChangeAdvice, modelChangeAdvice, type CostAdvice } from '../costAdvice';
import { Dropdown } from './Dropdown';
import { usePaneTabId } from '../paneContext';
import type { PermissionMode } from '@shared/ipc';


// Diferido (I6): CodeMirror 6 pesa +560 kB en el chunk de arranque; no hace falta hasta que se pinta
// el prompt. `PromptEditor` es un named export, de ahi el .then que lo adapta al `default` que pide lazy.
const PromptEditor = lazy(() => import('./PromptEditor').then((m) => ({ default: m.PromptEditor })));

// Referencia estable para "esta pestana no ha reportado comandos": devolver [] recien creado en cada
// render haria que el selector de Zustand viera un valor nuevo siempre y re-renderizara sin parar.
const EMPTY_COMMANDS: readonly SlashCommand[] = [];

// Etiqueta corta del chip de esfuerzo (M2.4). '' = sin fijar -> default del CLI.
const EFFORT_LABEL: Readonly<Record<string, string>> = {
  '': 'Esfuerzo auto',
  low: 'Esfuerzo bajo',
  medium: 'Esfuerzo medio',
  high: 'Esfuerzo alto',
  xhigh: 'Esfuerzo muy alto',
  max: 'Esfuerzo máximo',
};

// Cuanto se deja en pantalla un aviso de coste antes de desaparecer solo (ms).
const ADVICE_TIMEOUT_MS = 8000;

// Etiqueta corta de cada modo de permiso para el chip (M2.6).
const PERMISSION_MODE_LABEL: Readonly<Record<PermissionMode, string>> = {
  default: 'Manual',
  acceptEdits: 'Auto-editar',
  plan: 'Plan',
};

// Caja de prompt. Enter (sin shift) envia al motor real del chat activo; Shift+Enter salto de linea.
// Input rico (M3): Shift+Enter continua listas (- / * / + / 1.) y Tab/Shift+Tab indenta/desindenta
// la(s) linea(s) de la seleccion; la logica vive en el modulo puro promptEditing.
// Boton ✨ (M2.3): pide una mejora del borrador (solo Claude) y la muestra como PREVIEW editable con
// Aceptar / Rechazar / Rehacer (no reemplaza el borrador hasta que el usuario acepta).
// Lee un `File` a base64 SIN el prefijo `data:`. La validacion de tipo/tamaño la hace el modulo puro:
// aqui solo se convierte.
async function readImageFile(file: File): Promise<PendingAttachment> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    attachment: { mediaType: file.type as ImageAttachment['mediaType'], data: btoa(binary) },
    byteLength: bytes.byteLength,
  };
}

// Referencia ESTABLE para "esta pestaña no tiene borrador": un objeto nuevo por render haria que el
// selector de zustand viera un valor distinto siempre y repintara la barra en bucle.
const EMPTY_DRAFT: PromptDraft = { text: '', attachments: [] };

export function PromptBar(): React.JSX.Element {
  // La pestaña de ESTE panel (item 13). Las acciones del store siguen operando sobre la pestaña
  // ACTIVA, no sobre esta: es correcto porque el panel se enfoca (focusPane) en cuanto se interactua
  // con el — ver ChatPane.tsx. Aqui solo se LEE, para que el panel sin foco pinte sus propios datos.
  const activeTabId = usePaneTabId();
  const sendActiveMessage = useWorkbenchStore((s) => s.sendActiveMessage);
  const activeTab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const sessionId = useWorkbenchStore((s) => s.sessionIdByChat[activeTabId]);
  const openHandoff = useWorkbenchStore((s) => s.openHandoff);
  const setActiveModel = useWorkbenchStore((s) => s.setActiveModel);
  const cyclePermissionMode = useWorkbenchStore((s) => s.cyclePermissionMode);
  const compactActiveSession = useWorkbenchStore((s) => s.compactActiveSession);
  const setActiveEffort = useWorkbenchStore((s) => s.setActiveEffort);
  const interruptActiveSession = useWorkbenchStore((s) => s.interruptActiveSession);
  const keybindingOverrides = useWorkbenchStore((s) => s.settings.keybindingOverrides);
  // Estado del turno de la pestana activa: con el turno en marcha se ofrece "Parar" en vez de ⏎.
  const chatStatus = useWorkbenchStore((s) => s.statusByChat[activeTabId] ?? 'idle');
  // Comandos "/" reales que declaro la sesion en su arranque (D4); vacio -> se usa la lista curada.
  const sessionSlashCommands = useWorkbenchStore((s) => s.slashCommandsByChat[activeTabId] ?? EMPTY_COMMANDS);
  // Peticion de foco desde el store (nueva conversacion / abrir del historial).
  const promptFocusToken = useWorkbenchStore((s) => s.promptFocusToken);
  // BORRADOR de ESTA conversacion (auditoria B.1.2). Ya no es estado local: `PromptBar` no se remonta
  // al cambiar de pestaña, asi que el texto y los adjuntos de A seguian en la caja al activar B y el
  // Enter los mandaba a B. En el store, cada conversacion conserva el suyo y el envio limpia el de la
  // pestaña a la que de verdad se envio.
  const draft = useWorkbenchStore((s) => s.draftByChat[activeTabId] ?? EMPTY_DRAFT);
  const setDraft = useWorkbenchStore((s) => s.setDraft);
  const text = draft.text;
  const attachments = draft.attachments;
  const setText = (next: string): void => setDraft(activeTabId, { text: next, attachments });
  // Acepta valor o actualizador, como el `useState` al que sustituye: asi los dos sitios que añaden o
  // quitan un adjunto siguen leyendose igual.
  const setAttachments = (
    next: readonly PendingAttachment[] | ((current: readonly PendingAttachment[]) => readonly PendingAttachment[]),
  ): void => setDraft(activeTabId, { text, attachments: typeof next === 'function' ? next(attachments) : next });
  // Aviso de coste tras cambiar modelo/esfuerzo (B1). Se autodescarta a los pocos segundos.
  const [advice, setAdvice] = useState<CostAdvice | null>(null);
  // Autocompletado de comandos "/" (M2.6): indice seleccionado + flag de descartado (Escape).
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // sugerencia de mejora (editable)
  const [busy, setBusy] = useState(false); // mejorando/rehaciendo
  const [error, setError] = useState<string | null>(null);
  // Editores detectados en el PATH (se cargan una vez; el PATH no cambia durante la sesion).
  const [editors, setEditors] = useState<readonly EditorInfo[]>([]);
  // Editor WYSIWYG (2.7). El handle expone lo unico que la barra necesita del editor: foco, estado de
  // texto y aplicar un resultado de `promptEditing`. Con el se van el `pendingSelectionRef` del
  // textarea (CodeMirror aplica seleccion en la misma transaccion) y el efecto de auto-crecimiento (que
  // ahora es UNA regla CSS sobre `.cm-scroller`, en vez del mismo 200 escrito en dos sitios).
  const editorRef = useRef<PromptEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const disabled = activeTabId.length === 0;
  const activeModel = activeTab?.model ?? '';
  const isClaude = activeTab?.provider === 'claude';
  // Proveedor sin puente de permisos (E3, `agy`): auto-aprueba las tools y la UI tiene que decirlo.
  const autoApproved = activeTab !== undefined && isAutoApprovedProvider(activeTab.provider);
  const permissionMode: PermissionMode = activeTab?.permissionMode ?? 'default';
  const effort = activeTab?.effort ?? '';
  // Turno en marcha (generando o esperando permiso): se puede interrumpir.
  const running = chatStatus === 'streaming' || chatStatus === 'needs_permission';
  const canInterrupt = running && sessionId !== undefined;
  // Catalogo efectivo de comandos "/" (D4): manda lo que la sesion declaro; la lista curada solo
  // aporta descripciones y sirve de fallback mientras no hay init. Memoizado: reconstruirlo en cada
  // tecla pulsada seria ordenar 60 entradas por pulsacion.
  // Catalogo efectivo: el de la SESION si ya lo reporto; si no (conversacion recien abierta, porque
  // `ensureSession` es perezoso), la cache en disco de la cuenta (2.2). La cache es RESPALDO, nunca
  // fuente: en cuanto la sesion habla, manda ella.
  const cachedSlashCommands = useCachedCommandCatalog();
  const slashCatalog = useMemo(
    () => buildSlashCatalog(sessionSlashCommands.length > 0 ? sessionSlashCommands : cachedSlashCommands),
    [sessionSlashCommands, cachedSlashCommands],
  );
  // Sugerencias de comando "/" para el texto actual (vacio si no procede). El popover se abre salvo
  // que el usuario lo haya descartado con Escape (se reabre al seguir escribiendo).
  // Memoizado: se recalculaba en CADA pulsacion de tecla, y el catalogo real tiene cientos de
  // entradas cuando hay plugins (P16).
  const slashSuggestions = useMemo(() => filterSlashCommands(text, slashCatalog), [text, slashCatalog]);
  const slashOpen = slashSuggestions.length > 0 && !slashDismissed && !disabled;
  const slashCursor = Math.min(slashIndex, slashSuggestions.length - 1);
  const canImprove = !disabled && !busy && text.trim().length > 0 && isClaude;
  // Handoff: necesita una sesion reanudable (viva o restaurada) y solo Claude soporta --resume.
  const canHandoff = isClaude && (sessionId !== undefined || activeTab?.resumeSessionId !== undefined);

  // Foco del input: al montar y cada vez que el store lo PIDE (crear/abrir conversacion, o elegir una
  // pestaña). Sin esto el usuario tenia que clicar el input antes de escribir — y Shift+Tab (modo de
  // permiso) no llegaba al textarea, asi que parecia no funcionar.
  //
  // `activeTabId` NO va en las dependencias, y es deliberado: con el, CUALQUIER cambio de pestaña se
  // llevaba el foco al textarea, incluido el que hacen las FLECHAS sobre el tablist de pestañas — asi
  // que la segunda flecha ya no llegaba al tablist y la barra era inservible con el teclado (medido por
  // `pnpm verify:gui` el 2026-08-12; misma familia que el `role="tablist"` de Configuracion). Quien
  // quiere el foco lo pide por el token: `openTab`/`openConversation` en el store y el clic (o
  // Enter/Espacio) sobre una pestaña.
  //
  // Con N paneles (I11-drag) el token es GLOBAL: lo ve todo `PromptBar` montado, no solo el del panel
  // que lo pidio. Sin la guarda de abajo, dividir/mover un panel hacia foco disparaba el `.focus()` de
  // TODOS los paneles a la vez y ganaba el ultimo `requestAnimationFrame` en resolver — casi nunca el
  // panel correcto (asi se detecto arrastrando una pestaña: la activa acababa siendo la de destino, no
  // la arrastrada). Se lee `activeTabId` fresco por ref (no por dependencia, para no reabrir el bug de
  // las flechas) y solo se enfoca si ESTE panel es el que de verdad lo pidio.
  const paneTabIdRef = useRef(activeTabId);
  paneTabIdRef.current = activeTabId;
  useEffect(() => {
    if (disabled) return;
    if (paneTabIdRef.current !== useWorkbenchStore.getState().activeTabId) return;
    const id = requestAnimationFrame(() => editorRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [promptFocusToken, disabled]);

  // El aviso de coste desaparece solo (no es un error que haya que atender).
  useEffect(() => {
    if (advice === null) return;
    const timer = setTimeout(() => setAdvice(null), ADVICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [advice]);

  // Deteccion de editores (una vez al montar). Fallo de IPC -> lista vacia (item deshabilitado).
  useEffect(() => {
    let cancelled = false;
    void window.mage
      .listEditors()
      .then((list) => {
        if (!cancelled) setEditors(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // `override` sirve para enviar un texto DISTINTO del que hay en el estado sin pasar por un
  // `setText` (que es asincrono y llegaria tarde): lo usa el envio desde un item de lista vacio, que
  // manda el borrador SIN el marcador huerfano.
  const submit = (override?: string): void => {
    const trimmed = (override ?? text).trim();
    // Con adjuntos, un mensaje SIN texto es valido (mandar solo una imagen es un caso real).
    if ((trimmed.length === 0 && attachments.length === 0) || disabled) return;
    const sent = attachments.map((a) => a.attachment);
    setDraft(activeTabId, null);
    setPreview(null);
    setError(null);
    void sendActiveMessage(trimmed, sent);
  };

  // Cambio de modelo en caliente + aviso de coste (B1): el usuario ve que Opus muerde mas bolsa que
  // Sonnet y que el cambio aplica al SIGUIENTE turno.
  const changeModel = (model: string): void => {
    setAdvice(modelChangeAdvice(activeModel, model));
    setActiveModel(model);
  };

  // Cambio de nivel de esfuerzo (--effort): flag de arranque, el aviso lo explica.
  const changeEffort = (level: string): void => {
    setAdvice(effortChangeAdvice(level, sessionId !== undefined));
    setActiveEffort(level);
  };

  // Pide una mejora del borrador actual y la deja como preview. `redo` distingue el boton Rehacer
  // (mismo origen: el borrador) para el texto del error, pero la logica es la misma.
  const runImprove = async (): Promise<void> => {
    if (!canImprove || activeTab === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const improved = await window.mage.improvePrompt({ draft: text, accountDir: activeTab.accountId });
      setPreview(improved);
    } catch (err) {
      setError(`No se pudo mejorar el prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const acceptPreview = (): void => {
    if (preview === null) return;
    setText(preview);
    setPreview(null);
    // Reenfoca el textarea para seguir editando el prompt aceptado.
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  // Aplica un resultado del modulo de edicion rica. CodeMirror cambia texto y seleccion en la MISMA
  // transaccion, asi que ya no hace falta agendar la seleccion para el render siguiente.
  const applyEdit = (result: TextState): void => {
    setText(result.value);
    editorRef.current?.applyTextState(result);
  };

  const currentTextState = (): TextState =>
    editorRef.current?.getTextState() ?? { value: text, selectionStart: text.length, selectionEnd: text.length };

  // Cambio del texto: ademas resetea el estado del autocompletado "/" (reabrir + primera sugerencia).
  const onChangeText = (value: string): void => {
    setText(value);
    setSlashDismissed(false);
    setSlashIndex(0);
  };

  // Inserta el comando elegido ("/name ") y cierra el popover; el cursor queda al final para el argumento.
  const completeSlash = (command: SlashCommand): void => {
    const completion = completionFor(command);
    setText(completion);
    setSlashDismissed(true);
    editorRef.current?.applyTextState({ value: completion, selectionStart: completion.length, selectionEnd: completion.length });
  };

  // Puente de teclado del editor (2.7). MISMO orden de precedencia que tenia el textarea, y devuelve
  // `true` SOLO cuando ha actuado: devolver `true` de mas dejaria a CodeMirror sordo a teclas que nadie
  // ha reclamado (moverse, seleccionar, deshacer...).
  const onKeyDown = (e: KeyboardEvent): boolean => {
    // 1. Popover "/" abierto: flechas navegan, Enter/Tab completan, Escape cierra. Lo mas prioritario.
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        setSlashIndex((i) => (i + 1) % slashSuggestions.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        setSlashIndex((i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length);
        return true;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && slashSuggestions[slashCursor] !== undefined) {
        completeSlash(slashSuggestions[slashCursor]);
        return true;
      }
      if (e.key === 'Escape') {
        setSlashDismissed(true);
        return true;
      }
    }
    // 2. Shift+Enter: continuar lista si aplica; si no, salto de linea del editor. NO es rebindable
    // (D5 §2.2): es la convencion universal de "salto de linea".
    if (e.key === 'Enter' && e.shiftKey) {
      const result = continueListOnNewline(currentTextState());
      if (result === null) return false;
      applyEdit(result);
      return true;
    }
    // 3. Enter: la decision vive en `enterAction`, PURA y con 12 tests, porque equivocarse aqui cuesta
    // un turno real (enviar un mensaje a medias).
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const state = currentTextState();
      const action = enterAction(state);
      if (action === 'continue-list') {
        const result = continueListOnNewline(state);
        if (result !== null) applyEdit(result);
        return true;
      }
      if (action === 'newline') return false; // dentro de una valla: que CodeMirror inserte el salto
      // Envia. Si el cursor esta en un item de lista VACIO (el caso en que `enterAction` decide enviar
      // estando en una lista), el marcador huerfano NO viaja con el mensaje: `continueListOnNewline`
      // devuelve el borrador ya sin el. Medido con un turno real: sin esto se enviaba "- uno\n- dos\n-".
      submit(continueListOnNewline(state)?.value);
      return true;
    }
    // 4. El resto de teclas rebindables del scope 'prompt' (D5 §2.2), con sus overrides y sus guards.
    const actionId = resolveKeyEvent({
      event: e,
      activeScopes: ['prompt'],
      overrides: keybindingOverrides,
      isMac: isMacPlatform(),
      focusInEditableText: true,
      guardContext: {
        promptTextEmpty: text.trim().length === 0,
        permissionPending: false,
        turnRunning: false,
        dialogOrPopoverOpen: false,
        focusInEditableText: true,
      },
    });
    if (actionId === null) return false; // 5. no es nuestra: la maneja CodeMirror
    const editState = currentTextState();
    switch (actionId) {
      case 'prompt.send':
        submit();
        return true;
      case 'prompt.indent':
        applyEdit(indentLines(editState));
        return true;
      case 'prompt.outdent':
        applyEdit(outdentLines(editState));
        return true;
      case 'prompt.cyclePermissionMode':
        if (isClaude) cyclePermissionMode();
        return true;
      default:
        return false;
    }
  };

  // Adjuntar imagenes (2.12.1), por pegado o por el selector de ficheros. La validacion es la del
  // modulo puro y su error se pinta en la linea `role="alert"` que ya existe: un adjunto que se cae en
  // silencio es peor que un error.
  const addFiles = (files: readonly File[]): void => {
    if (files.length === 0) return;
    void Promise.all(files.map(readImageFile))
      .then((candidates) => {
        const metas = attachments.map((a) => ({ mediaType: a.attachment.mediaType, byteLength: a.byteLength }));
        validateAttachmentSet(metas, candidates.map((c) => ({ mediaType: c.attachment.mediaType, byteLength: c.byteLength })));
        setError(null);
        setAttachments((current) => [...current, ...candidates]);
      })
      .catch((err: unknown) => setError(`No se pudo adjuntar: ${err instanceof Error ? err.message : String(err)}`));
  };

  return (
    <div className="border-t border-mg-border p-[12px_22px]">
      {/* Una sola linea de error para toda la barra: cada origen (mejora del prompt, adjuntos) pone su
          propio prefijo, para que el mensaje describa lo que de verdad ha fallado. */}
      {error !== null && <div role="alert" className="mb-[6px] text-[10.5px] text-mg-danger">{error}</div>}

      {preview !== null && (
        <ImprovePreview
          value={preview}
          busy={busy}
          onChange={setPreview}
          onAccept={acceptPreview}
          onReject={() => setPreview(null)}
          onRedo={() => void runImprove()}
        />
      )}
      {busy && preview === null && (
        <div className="mb-[6px] flex items-center gap-[6px] text-[10.5px] text-mg-sec">
          <Spinner /> Mejorando el prompt…
        </div>
      )}

      {advice !== null && <CostAdviceBanner advice={advice} onDismiss={() => setAdvice(null)} />}

      {/* Tira de adjuntos (2.12.1): las imagenes que se van a enviar con este mensaje. */}
      {attachments.length > 0 && (
        <div className="mb-[8px] flex flex-wrap gap-[6px]">
          {attachments.map((item, index) => (
            <div key={`${item.attachment.data.slice(0, 24)}-${index}`} className="relative">
              <img
                src={`data:${item.attachment.mediaType};base64,${item.attachment.data}`}
                alt={`Adjunto ${index + 1}`}
                data-attachment="thumb"
                className="h-[56px] w-auto rounded-[6px] border border-mg-border-ctrl"
              />
              <button
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                aria-label={`Quitar el adjunto ${index + 1}`}
                className="absolute -right-[6px] -top-[6px] flex h-[16px] w-[16px] items-center justify-center rounded-full border border-mg-border-ctrl bg-mg-panel text-[9px] text-mg-body2 hover:bg-mg-hover"
              >
                <Icon name="close" size={11} label="Descartar aviso" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* `flex-wrap`: los controles (todos `shrink-0`) bajan a la linea siguiente cuando no caben junto al
          editor, en vez de estrujarlo a 0 px de ancho — ver el comentario del host en PromptEditor.tsx. */}
      <div className="relative flex flex-wrap items-end gap-[10px] rounded-[9px] border border-mg-border-ctrl bg-mg-panel p-[10px_14px]">
        {slashOpen && (
          // Popover de comandos "/" (M2.6): navegable con flechas/Enter/Tab; click completa.
          <div
            role="listbox"
            aria-label="Comandos disponibles"
            className="absolute bottom-full left-0 mb-[6px] w-[300px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-panel py-[4px] mg-shadow-pop"
          >
            {slashSuggestions.map((command, i) => (
              <button
                key={command.name}
                role="option"
                aria-selected={i === slashCursor}
                onClick={() => completeSlash(command)}
                onMouseEnter={() => setSlashIndex(i)}
                className={`flex w-full items-baseline gap-[8px] px-[11px] py-[6px] text-left ${i === slashCursor ? 'bg-mg-hover' : ''}`}
              >
                <span className="font-mono text-[11.5px] text-mg-body">/{command.name}</span>
                {/* La pista del argumento (2.2) se PINTA, no se inserta: dice QUE espera el comando, no
                    con que valor. Los alias, entre parentesis. */}
                {command.argumentHint !== null && command.argumentHint !== undefined && (
                  <span className="flex-none font-mono text-[10.5px] italic text-mg-ter">{command.argumentHint}</span>
                )}
                <span className="truncate text-[10.5px] text-mg-muted">{command.description}</span>
                {(command.aliases?.length ?? 0) > 0 && (
                  <span className="flex-none text-[10px] text-mg-muted">({command.aliases?.join(', ')})</span>
                )}
              </button>
            ))}
          </div>
        )}
        <span className="pt-[1px] font-mono text-mg-ter">›</span>
        <Suspense fallback={<div className="min-h-[1.5em] flex-1" aria-hidden="true" />}>
          <PromptEditor
            handleRef={editorRef}
            value={text}
            disabled={disabled}
            ariaLabel="Escribe una instrucción para el agente"
            placeholder={disabled ? 'Abre una pestaña para escribir…' : 'Escribe una instrucción…'}
            onChange={onChangeText}
            onKeyDown={onKeyDown}
            onPasteImages={addFiles}
          />
        </Suspense>
        {/* Adjuntar imagenes (2.12.1): un `<input type="file">` NATIVO, sin IPC ni dialogo de main —
            es la via mas barata y ya funciona en los tres SO. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          aria-label="Adjuntar imágenes"
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = ''; // permite volver a elegir el MISMO fichero
          }}
        />
        {/* "Adjuntar" ya NO es un boton propio de la barra (peticion del usuario): vive en el menu de
            opciones, junto al resto de acciones sobre el mensaje. Pegar una imagen sigue funcionando
            igual — es la via rapida, y esta no compite con ella por sitio en la barra. */}
        {activeTab !== undefined && (
          <ActionsMenu
            busy={busy}
            items={[
              {
                icon: 'paperclip',
                label: 'Adjuntar una imagen',
                onClick: () => fileInputRef.current?.click(),
                // Sin pestaña abierta no hay a donde adjuntar: mismo criterio que el editor.
                disabled,
                title: disabled ? 'Abre una pestaña para poder adjuntar' : 'También puedes pegar una imagen en el editor',
              },
              { icon: 'sparkles', label: 'Mejorar prompt', onClick: () => void runImprove(), disabled: !canImprove, hidden: !isClaude },
              {
                icon: 'handshake',
                label: 'Prompt de handoff',
                onClick: openHandoff,
                disabled: !canHandoff,
                hidden: !isClaude,
                title: canHandoff ? undefined : 'Envía al menos un mensaje para poder hacer handoff',
              },
              {
                icon: 'compress',
                label: 'Compactar ahora',
                onClick: () => void compactActiveSession(),
                // Mismo criterio que el handoff: hace falta una sesion viva o reanudable.
                disabled: !canHandoff,
                hidden: !isClaude,
                title: canHandoff ? 'Compacta el contexto de la sesión (/compact)' : 'Envía al menos un mensaje para poder compactar',
              },
              { icon: 'folder', label: 'Abrir carpeta', onClick: () => void window.mage.openPath(activeTab.cwd).catch(() => undefined) },
              { icon: 'monitor', label: 'Abrir terminal', onClick: () => void window.mage.openTerminal(activeTab.cwd).catch(() => undefined) },
              // "Abrir en <editor>": un item por editor detectado; si no hay ninguno, un unico
              // item deshabilitado con el motivo en el title.
              ...(editors.length > 0
                ? editors.map((editor) => ({
                    icon: 'pencil' as const,
                    label: `Abrir en ${editor.label}`,
                    onClick: () =>
                      void window.mage.openEditor({ bin: editor.bin, cwd: activeTab.cwd }).catch(() => undefined),
                  }))
                : [
                    {
                      icon: 'pencil' as const,
                      label: 'Abrir en editor',
                      onClick: () => undefined,
                      disabled: true,
                      title: 'No se detectó ningún editor en el PATH',
                    },
                  ]),
            ]}
          />
        )}
        {autoApproved && (
          // Aviso PERMANENTE de "sin control de permisos" (E3). Ocupa el sitio del chip de modo de
          // permiso, que para este proveedor no existe y no puede fingir que si: su CLI no tiene puente
          // de permisos, asi que la pestana auto-aprueba. No es solo un color: lleva el glifo y el texto
          // "Sin permisos" visibles, el detalle completo en el tooltip y en el aria-label, y `role=status`
          // para que un lector de pantalla lo anuncie al abrir la pestana.
          <span
            role="status"
            data-tip={NO_PERMISSION_CONTROL_WARNING}
            aria-label={NO_PERMISSION_CONTROL_WARNING}
            className="shrink-0 cursor-help self-center rounded-full border border-mg-warn-border bg-mg-warn-bg px-[8px] py-[2px] text-[10.5px] font-semibold text-mg-warn-text"
          >
            <Icon name="warning" size={12} /> Sin permisos
          </span>
        )}
        {isClaude && (
          // Chip de modo de permiso (M2.6, solo Claude): click cicla default->acceptEdits->plan;
          // tambien con Shift+Tab si el input esta vacio. plan/acceptEdits se resaltan (ambar).
          <button
            onClick={() => cyclePermissionMode()}
            data-tip="Modo de permiso (click o Shift+Tab con el input vacío): Manual → Auto-editar → Plan"
            aria-label={`Modo de permiso: ${PERMISSION_MODE_LABEL[permissionMode]}`}
            className={`shrink-0 cursor-pointer self-center rounded-full border px-[8px] py-[2px] text-[10.5px] ${
              permissionMode === 'default'
                ? 'border-mg-border-ctrl text-mg-sec hover:text-mg-body'
                : 'border-mg-warn-border bg-mg-warn-bg text-mg-warn-text'
            }`}
          >
            {permissionMode === 'plan' ? <Icon name="clipboard" size={11} /> : permissionMode === 'acceptEdits' ? <Icon name="pencil" size={11} /> : null}
            {PERMISSION_MODE_LABEL[permissionMode]}
          </button>
        )}
        {isClaude && (
          // Selector de esfuerzo (--effort, M2.4 / B4): flag de ARRANQUE del CLI, no hay cambio en
          // caliente; el aviso lo aclara al elegir. Dropdown propio (F6, feedback del usuario): el
          // `<select>` nativo se veia inconsistente con el resto de la app y su popup, al ser del propio
          // navegador, tapaba cualquier tooltip mientras estaba abierto.
          <Dropdown
            value={effort}
            onChange={changeEffort}
            options={[{ value: '', label: EFFORT_LABEL[''] ?? '' }, ...EFFORT_LEVELS.map((level) => ({ value: level, label: EFFORT_LABEL[level] ?? level }))]}
            tip="Nivel de esfuerzo del modelo (--effort). Se aplica al arrancar o reabrir la conversación."
            ariaLabel="Nivel de esfuerzo"
          />
        )}
        {activeModel.length > 0 && isClaude && (
          // Dropdown de modelo en caliente (M2.4, solo Claude): set_model aplica al siguiente turno.
          <Dropdown
            value={activeModel}
            onChange={changeModel}
            options={modelOptionsForProvider('claude', activeModel).map((option) => ({ value: option.id, label: option.label }))}
            tip="Cambiar el modelo (aplica al siguiente turno)"
            ariaLabel="Modelo (aplica al siguiente turno)"
          />
        )}
        {activeModel.length > 0 && !isClaude && (
          <span className="shrink-0 self-center rounded-full border border-mg-border-ctrl px-[8px] py-[2px] text-[10.5px] text-mg-sec">{activeModel}</span>
        )}
        {canInterrupt ? (
          // Parar la acción en curso (B3): interrumpe el turno (control_request interrupt). El CLI
          // cierra el turno con su `result` y el chat vuelve a 'idle'.
          <button
            onClick={interruptActiveSession}
            data-tip="Parar la acción en curso (interrumpe el turno)"
            aria-label="Parar la acción en curso"
            className="shrink-0 cursor-pointer self-center rounded-full border border-mg-danger-border bg-mg-danger-bg px-[9px] py-[2px] text-[10.5px] font-semibold text-mg-danger hover:opacity-90"
          >
            <Icon name="stop" size={11} /> Parar
          </button>
        ) : (
          <span className="shrink-0 self-center font-mono text-[10.5px] text-mg-muted">⏎</span>
        )}
      </div>
    </div>
  );
}

// Aviso de coste tras cambiar de modelo/esfuerzo (B1). Ambar cuando el cambio encarece; tenue cuando
// solo informa. Descartable y con autocierre (lo gestiona el llamante).
function CostAdviceBanner({
  advice,
  onDismiss,
}: {
  readonly advice: CostAdvice;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const skin =
    advice.severity === 'warn'
      ? 'border-mg-warn-border bg-mg-warn-bg text-mg-warn-text'
      : 'border-mg-border-subtle bg-mg-code text-mg-sec';
  return (
    <div role="status" className={`mb-[6px] flex items-center gap-[8px] rounded-[7px] border p-[6px_10px] text-[10.5px] ${skin}`}>
      <Icon name={advice.severity === 'warn' ? 'warning' : 'info'} />
      <span className="min-w-0 flex-1">{advice.message}</span>
      <button onClick={onDismiss} aria-label="Descartar aviso" className="shrink-0 opacity-70 hover:opacity-100">
        <Icon name="close" size={11} label="Descartar aviso" />
      </button>
    </div>
  );
}

// Preview de la mejora: textarea EDITABLE con el prompt sugerido + Aceptar / Rechazar / Rehacer.
function ImprovePreview({
  value,
  busy,
  onChange,
  onAccept,
  onReject,
  onRedo,
}: {
  readonly value: string;
  readonly busy: boolean;
  readonly onChange: (v: string) => void;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly onRedo: () => void;
}): React.JSX.Element {
  return (
    <div className="mb-[8px] rounded-[9px] border border-mg-border-emph bg-mg-code p-[10px_12px]">
      <div className="mb-[6px] flex items-center gap-[6px] text-[10px] font-bold uppercase tracking-[.06em] text-mg-ter">
        <span className="flex items-center gap-[5px]"><Icon name="sparkles" size={12} /> Prompt mejorado</span>
        {busy && <Spinner />}
        <span className="font-normal normal-case text-mg-muted">— revísalo y edítalo si quieres</span>
      </div>
      <textarea
        rows={4}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        className="max-h-[240px] w-full resize-none overflow-y-auto rounded-[6px] border border-mg-border-subtle bg-mg-panel p-[8px] text-[12px] leading-[1.5] text-mg-body outline-none disabled:opacity-60"
      />
      <div className="mt-[8px] flex items-center gap-[8px]">
        <button
          onClick={onAccept}
          disabled={busy || value.trim().length === 0}
          className="rounded-[7px] bg-mg-primary px-[12px] py-[5px] text-[11.5px] font-semibold text-mg-primary-ink disabled:opacity-50"
        >
          Aceptar
        </button>
        <button onClick={onReject} disabled={busy} className="rounded-[7px] border border-mg-border-emph px-[12px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50">
          Rechazar
        </button>
        <button onClick={onRedo} disabled={busy} className="ml-auto rounded-[7px] border border-mg-border-emph px-[12px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50">
          ↻ Rehacer
        </button>
      </div>
    </div>
  );
}

interface ActionItem {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly hidden?: boolean; // no aplica al proveedor/estado actual -> ni se lista
  readonly title?: string; // motivo cuando esta deshabilitado
}

// Menu "⋯" que agrupa las acciones de la barra (mejorar, handoff, abrir carpeta/terminal) en un
// popover, para no llenar la fila del input de iconos sueltos. Popover hacia ARRIBA (la barra esta
// abajo) con cierre al hacer click fuera (backdrop transparente).
function ActionsMenu({ items, busy }: { readonly items: readonly ActionItem[]; readonly busy: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const visible = items.filter((i) => i.hidden !== true);

  const run = (item: ActionItem): void => {
    if (item.disabled === true) return;
    setOpen(false);
    item.onClick();
  };

  return (
    <div className="relative self-center" onKeyDown={(e) => e.key === 'Escape' && open && setOpen(false)}>
      <IconButton title="Acciones" onClick={() => setOpen((v) => !v)} ariaHasPopup="menu" ariaExpanded={open}>
        {busy ? <Spinner /> : '⋯'}
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute bottom-full right-0 z-20 mb-[6px] w-[190px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-panel py-[4px] mg-shadow-pop">
            {visible.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => run(item)}
                disabled={item.disabled === true}
                data-tip={item.title}
                className="flex w-full items-center gap-[9px] px-[11px] py-[6px] text-left text-[11.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon name={item.icon} className="text-mg-ter" />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  disabled = false,
  ariaHasPopup,
  ariaExpanded,
  children,
}: {
  readonly title: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly ariaHasPopup?: 'menu';
  readonly ariaExpanded?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-tip={title}
      aria-label={title}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      className="flex h-[22px] w-[24px] shrink-0 items-center justify-center self-center rounded-[6px] text-[12px] text-mg-sec hover:text-mg-body disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// Spinner minimo (borde girando) para dar feedback de "trabajando".
function Spinner(): React.JSX.Element {
  return <span className="inline-block h-[11px] w-[11px] animate-spin rounded-full border border-mg-border-emph border-t-mg-body" />;
}
