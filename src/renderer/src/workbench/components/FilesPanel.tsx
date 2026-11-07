import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HighlightedLines } from './Markdown';
import { useWorkbenchStore, type DocumentTarget } from '../workbenchStore';
import { useT } from '../../i18n/uiLanguage';
import { usePaneTabId } from '../paneContext';
import type { CreatedFile } from '../createdFilesView';
import { anchorTextMatcher, indexDocumentAnchors, panelEntries, type FileSection, type PanelEntry } from '../planReferences';
import { Markdown } from './Markdown';
import { Hint } from './TranscriptHint';
import { useHighlightedCode } from '../highlighter';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { langFromPath } from '../codeHighlight';
import type { Block } from '../types';
import type { ProjectFileContent } from '@shared/ipc';
import { describeError } from '../describeError';

// Panel "Ficheros" (2.10, peticion del usuario: "si creas un plan .md .txt o lo que sea tiene que
// aparecer a la derecha como un artifact y así poder ver el plan, poder editarlo").
//
// Tres decisiones que explican la forma de esto:
//
//  - La LISTA sale de los bloques del chat (`panelEntries`), no de un registro nuevo. Igual que el
//    panel de Artifacts, y por lo mismo: los bloques se hidratan desde la transcripcion al reabrir la
//    conversacion, asi que la lista sale completa tambien en una conversacion de hace un mes.
//  - El CONTENIDO se lee de DISCO, no del `writtenContent` del bloque. El fichero pudo cambiar despues
//    de crearse (lo edito el agente, o el usuario en su editor): ensenar el input de la tool seria
//    ensenar el pasado y, sobre todo, guardarlo encima pisaria lo que hay.
//  - Guardar es un COMPARE-AND-SWAP por mtime (lo hace main): si el fichero cambio desde que se leyo,
//    el guardado se RECHAZA con un mensaje y un boton de recargar. Nunca se pisa en silencio.
const EMPTY_BLOCKS: readonly Block[] = [];

// Resaltado de la referencia (F5.6, #31): cuanto dura, cuanto se espera a que termine el despliegue del
// visor (DISCLOSURE_VARIANTS, 0,18 s) antes de desplazar, cuanto vale un destino sin consumir y cuanto
// se queda el aviso de «ya no esta».
const ANCHOR_HIGHLIGHT_MS = 2000;
const ANCHOR_SCROLL_DELAY_MS = 220;
const TARGET_TTL_MS = 5000;
const GONE_NOTICE_MS = 5000;
const HIGHLIGHT_CLASSES = ['bg-mg-sel', 'text-mg-sel-ink'];

// Extensiones que se pintan como Markdown. El resto va en monospace tal cual: adivinar el formato de un
// fichero por su contenido es una fuente de sorpresas, y aqui el objetivo es LEER lo que hay.
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function FilesPanel(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY_BLOCKS);
  const cwd = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId)?.cwd ?? null);
  const entries = useMemo(() => (cwd === null ? [] : panelEntries(blocks, cwd)), [blocks, cwd]);
  const target = useWorkbenchStore((s) => s.documentTarget);
  const clearDocumentTarget = useWorkbenchStore((s) => s.clearDocumentTarget);
  // TRES estados, no dos, y cada uno significa algo distinto:
  //   undefined -> nadie ha elegido todavia; se abre el primero, como ha hecho siempre el panel.
  //   '<ruta>'  -> ese fichero, abierto a mano.
  //   null      -> CERRADO a mano (2026-09-21, feedback del usuario: "al volver a hacer clic sobre un
  //                archivo abierto, este no se cierra"). Sin este tercer estado no se puede distinguir
  //                "no ha elegido" de "ha elegido que no haya ninguno", y el `?? files[0]` de abajo
  //                reabria el primero en cuanto se cerraba el que estaba mirando.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);

  // El seleccionado por defecto es el ULTIMO creado, y cambia solo si el que estaba seleccionado
  // desaparece de la lista (otra conversacion, hilo recargado): reelegirlo en cada escritura del agente
  // sacaria de la pantalla el fichero que el usuario esta leyendo. Cerrado a mano manda sobre todo eso:
  // el panel no vuelve a abrir nada por su cuenta hasta que se pulse otro fichero.
  const selected = selectedId === null ? null : (entries.find((e) => e.docId === selectedId) ?? entries[0] ?? null);

  // Pulsar el que ya esta abierto lo CIERRA; pulsar otro cambia de fichero.
  // Numero de cada plan cuando hay varios (con uno solo, el titulo va sin numero).
  const planNumbers = useMemo(() => planNumberByDoc(entries), [entries]);
  const toggle = (docId: string): void => setSelectedId(selected?.docId === docId ? null : docId);

  // Una referencia del chat pide un documento: se selecciona (los visores consumen el destino). Si ya no
  // esta en la lista, el destino se descarta.
  useEffect(() => {
    if (target === null || target.tabId !== tabId) return;
    if (entries.some((e) => e.docId === target.docId)) setSelectedId(target.docId);
    else clearDocumentTarget();
  }, [target, tabId, entries, clearDocumentTarget]);

  if (cwd === null) return <Hint text={t('chat.files.noConversation')} />;
  if (entries.length === 0) {
    return <Hint text={t('chat.files.noFiles')} />;
  }

  return (
    // Ancla ESTABLE para `pnpm verify:gui`: los avisos (`role="alert"`) de este panel hay que medirlos
    // POR AMBITO — el hilo y el prompt tienen los suyos, y un scan global del documento se traia el
    // error de un adjunto rechazado de tres comprobaciones antes. No la usa ningun codigo de produccion.
    <div data-files-panel="true" className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-mg-border-subtle px-[10px] py-[6px] text-[10px] text-mg-ter">
        <span className="font-bold tracking-[.06em]">{t('chat.files.title', { count: entries.length })}</span>
      </div>
      {/* La lista ES el panel: `flex-1` en vez del `max-h-[35%]` de antes. El visor se pinta DENTRO del
          <li> del fichero elegido (2026-09-21, feedback del usuario: "el archivo que clico se renderiza
          abajo del todo en vez de justo debajo del propio archivo y desplazando el resto"), asi que lo
          que scrollea tiene que ser el conjunto lista+visor, no una cajita del 35% con el visor colgando
          por debajo. */}
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto p-[6px]">
        {entries.map((entry, index) => {
          const label = entryLabel(entry, planNumbers.get(entry.docId) ?? null, t);
          const isSelected = entry.docId === selected?.docId;
          const section = sectionOf(entry);
          const startsSection = index === 0 || sectionOf(entries[index - 1]!) !== section;
          return (
          <Fragment key={entry.docId}>
          {startsSection && (
            <li role="presentation" data-files-section={section} className="px-[8px] pb-[2px] pt-[8px] text-[9.5px] font-bold tracking-[.06em] text-mg-ter first:pt-[2px]">
              {sectionLabel(section, t)}
            </li>
          )}
          <li className="flex min-w-0 flex-col">
            <button
              onClick={() => toggle(entry.docId)}
              data-file-section={entry.kind === 'file' ? entry.section : undefined}
              aria-pressed={isSelected}
              aria-expanded={isSelected}
              {...(entry.kind === 'file' ? { 'data-created-file': entry.file.path } : { 'data-plan-doc': entry.docId })}
              className={`flex w-full flex-col items-start gap-[1px] rounded-[6px] px-[8px] py-[5px] text-left ${
                isSelected ? 'bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'hover:bg-mg-hover'
              }`}
            >
              <span className="flex w-full items-center gap-[6px]">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-mg-body">{label.name}</span>
                {label.cited && (
                  <span data-cited-file="true" className="shrink-0 rounded-[4px] border border-mg-border-subtle px-[4px] text-[9.5px] text-mg-muted">
                    {t('chat.files.cited')}
                  </span>
                )}
                {label.failed && (
                  <span className="shrink-0 text-[10px] text-mg-danger" title={t('chat.files.writeFailedTip')}>
                    {t('chat.files.writeFailed')}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-[10px] text-mg-muted">{label.dir}</span>
            </button>
            {/* `initial={false}`: al ABRIR el panel, el fichero que ya venia elegido aparece puesto, sin
                desplegarse solo. La animacion es para lo que el usuario hace, no para lo que se
                encuentra hecho.

                El borde y el margen van DENTRO del elemento animado: en la caja que encoge solo puede
                haber `overflow-hidden`, o con altura 0 quedarian a la vista dos lineas y un hueco de
                4px del fichero que acabas de cerrar.

                `key={file.path}` en el visor: cambiar de fichero MONTA otro, asi que el borrador, el
                modo de edicion y el error se reinician solos (contrato que ya tenia cuando vivia
                fuera de la lista). */}
            <AnimatePresence initial={false}>
              {isSelected && (
                <motion.div
                  key="viewer"
                  variants={DISCLOSURE_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="overflow-hidden"
                >
                  <div className="mt-[4px] min-w-0 rounded-[6px] border border-mg-border-subtle">
                    {/* Solo pregunta por un fichero de fuera si lo eligio el usuario: el que se abre solo
                        (el ultimo creado, al abrir el panel) no puede saltar con un dialogo. */}
                    {entry.kind === 'file' ? (
                      <FileViewer key={entry.docId} docId={entry.docId} file={entry.file} cwd={cwd} askOutside={selectedId === entry.docId} />
                    ) : (
                      <PlanViewer key={entry.docId} docId={entry.docId} name={label.name} text={entry.text} />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
          </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

type Translate = ReturnType<typeof useT>;

interface EntryLabel {
  readonly name: string;
  readonly dir: string;
  readonly failed: boolean;
  // Documento citado en el hilo que el agente no creo (distintivo en la fila).
  readonly cited: boolean;
}

// Con varios planes, cada uno lleva su numero (orden de aparicion en el hilo); con uno, ninguno.
function planNumberByDoc(entries: readonly PanelEntry[]): ReadonlyMap<string, number> {
  const plans = entries.filter((entry) => entry.kind === 'plan');
  if (plans.length < 2) return new Map();
  return new Map(plans.map((entry, index) => [entry.docId, index + 1]));
}

function entryLabel(entry: PanelEntry, planNumber: number | null, t: Translate): EntryLabel {
  if (entry.kind === 'file') return { name: entry.file.name, dir: entry.file.dir, failed: entry.file.failed, cited: entry.cited };
  const name = planNumber === null ? t('chat.references.planTitle') : t('chat.references.planTitleNumbered', { number: planNumber });
  return { name, dir: entry.title, failed: false, cited: false };
}

type PanelSection = FileSection | 'plans';

function sectionOf(entry: PanelEntry): PanelSection {
  return entry.kind === 'plan' ? 'plans' : entry.section;
}

function sectionLabel(section: PanelSection, t: Translate): string {
  switch (section) {
    case 'created':
      return t('i3.files.section.created');
    case 'edited':
      return t('i3.files.section.edited');
    case 'read':
      return t('i3.files.section.read');
    case 'mentioned':
      return t('i3.files.section.mentioned');
    case 'plans':
      return t('i3.files.section.plans');
  }
}

// Destino pendiente de ESTE documento en ESTA pestana, o null.
function useDocumentTarget(docId: string): DocumentTarget | null {
  const tabId = usePaneTabId();
  const target = useWorkbenchStore((s) => s.documentTarget);
  return target !== null && target.tabId === tabId && target.docId === docId ? target : null;
}

// Primer encabezado (o elemento de lista, salvo para las secciones) pintado cuyo texto empieza por la clave.
function findAnchorElement(root: HTMLElement, key: string): HTMLElement | null {
  const matcher = anchorTextMatcher(key);
  const selector = key.startsWith('§') ? '[data-md-heading]' : '[data-md-heading], li';
  const candidates = root.querySelectorAll<HTMLElement>(selector);
  return [...candidates].find((el) => matcher.test((el.textContent ?? '').trim())) ?? null;
}

function setHighlight(el: HTMLElement, on: boolean): void {
  if (on) el.setAttribute('data-anchor-highlight', 'true');
  else el.removeAttribute('data-anchor-highlight');
  el.classList.toggle(HIGHLIGHT_CLASSES[0] ?? '', on);
  el.classList.toggle(HIGHLIGHT_CLASSES[1] ?? '', on);
}

// Desplazar hasta el punto de un documento ya pintado y resaltarlo ANCHOR_HIGHLIGHT_MS; o, si el punto no
// esta en el texto actual, avisar. Los temporizadores se limpian al desmontar el visor.
function useAnchorReveal(): {
  readonly rootRef: React.RefObject<HTMLDivElement | null>;
  readonly gone: boolean;
  readonly reveal: (docId: string, text: string, key: string) => void;
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [gone, setGone] = useState(false);
  const timers = useRef<number[]>([]);
  const highlighted = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((id) => window.clearTimeout(id));
      if (highlighted.current !== null) setHighlight(highlighted.current, false);
    };
  }, []);

  const later = useCallback((action: () => void, ms: number) => {
    timers.current.push(window.setTimeout(action, ms));
  }, []);

  const reveal = useCallback(
    (docId: string, text: string, key: string) => {
      const found = indexDocumentAnchors(docId, text).some((anchor) => anchor.key === key);
      setGone(!found);
      if (!found) return later(() => setGone(false), GONE_NOTICE_MS);
      later(() => {
        const el = rootRef.current === null ? null : findAnchorElement(rootRef.current, key);
        if (el === null) return setGone(true);
        el.scrollIntoView({ block: 'center' });
        setHighlight(el, true);
        highlighted.current = el;
        later(() => setHighlight(el, false), ANCHOR_HIGHLIGHT_MS);
      }, ANCHOR_SCROLL_DELAY_MS);
    },
    [later],
  );
  return { rootRef, gone, reveal };
}

function GoneNotice(): React.JSX.Element {
  const t = useT();
  return (
    <div role="status" data-anchor-gone="true" className="shrink-0 border-b border-mg-border-subtle p-[8px_10px] text-[10.5px] text-mg-muted">
      {t('chat.references.gone')}
    </div>
  );
}

// Plan del modo plan: documento virtual de solo lectura (sin disco, sin editar, sin guardar).
function PlanViewer({ docId, name, text }: { readonly docId: string; readonly name: string; readonly text: string }): React.JSX.Element {
  const target = useDocumentTarget(docId);
  const clearDocumentTarget = useWorkbenchStore((s) => s.clearDocumentTarget);
  const { rootRef, gone, reveal } = useAnchorReveal();
  useEffect(() => {
    if (target === null) return;
    clearDocumentTarget();
    if (Date.now() - target.at <= TARGET_TTL_MS) reveal(docId, text, target.key);
  }, [target, docId, text, reveal, clearDocumentTarget]);
  return (
    <div ref={rootRef} data-plan-viewer={docId} className="flex min-w-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-mg-border-subtle px-[10px] py-[5px]">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mg-sec">{name}</span>
      </div>
      {gone && <GoneNotice />}
      <div className="min-h-0 flex-1 overflow-auto p-[10px_12px] text-[12px] leading-[1.6]">
        <Markdown text={text} />
      </div>
    </div>
  );
}

// Visor/editor de UN fichero. `key={path}` en el caller: al cambiar de fichero se monta uno nuevo, asi
// que no hace falta reiniciar a mano el borrador, el modo de edicion ni el error.
function FileViewer({
  docId,
  file,
  cwd,
  askOutside,
}: {
  readonly docId: string;
  readonly file: CreatedFile;
  readonly cwd: string;
  readonly askOutside: boolean;
}): React.JSX.Element {
  const t = useT();
  const [loaded, setLoaded] = useState<ProjectFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // null = no se esta editando
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setLoaded(null);
    void window.mage
      .readProjectFile({ cwd, path: file.path })
      .then((content) => {
        setLoaded(content);
        // Si se estaba editando, el borrador se REEMPLAZA por lo que hay en disco: recargar es
        // justamente la salida del conflicto ("el fichero cambió, mira lo que hay ahora").
        setDraft(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? describeError(err) : String(err)));
  }, [cwd, file.path]);

  useEffect(load, [load]);

  // Una referencia del chat apunta a este documento: se RELEE de disco (pudo cambiar desde que se
  // abrio) y, con el contenido nuevo, se busca el punto. En el primer montaje ya hay una lectura en curso.
  const target = useDocumentTarget(docId);
  const clearDocumentTarget = useWorkbenchStore((s) => s.clearDocumentTarget);
  const { rootRef, gone, reveal } = useAnchorReveal();
  const [awaiting, setAwaiting] = useState<DocumentTarget | null>(null);
  const hadContent = useRef(false);
  useEffect(() => {
    if (target === null) return;
    clearDocumentTarget();
    if (Date.now() - target.at > TARGET_TTL_MS) return;
    if (hadContent.current) load();
    setAwaiting(target);
  }, [target, load, clearDocumentTarget]);
  useEffect(() => {
    hadContent.current = loaded?.content != null;
    if (awaiting === null || loaded?.content == null) return;
    setAwaiting(null);
    reveal(docId, loaded.content, awaiting.key);
  }, [awaiting, loaded, docId, reveal]);

  // Fuera de la carpeta de la conversacion (P-028, 15): la pregunta la hace main con un dialogo nativo
  // y, si se aprueba, se vuelve a leer. Cancelar deja el aviso con «Abrir de todos modos…».
  const approveOutside = useCallback(() => {
    void window.mage
      .approveProjectFileOutside({ cwd, path: file.path })
      .then((approved) => {
        if (approved) load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? describeError(err) : String(err)));
  }, [cwd, file.path, load]);

  // Se pregunta UNA vez al abrirlo; despues, solo si el usuario pulsa el boton del aviso.
  const askedRef = useRef(false);
  useEffect(() => {
    if (loaded?.outsideCwd !== true || !askOutside || askedRef.current) return;
    askedRef.current = true;
    approveOutside();
  }, [loaded, askOutside, approveOutside]);

  const save = (): void => {
    if (draft === null || loaded === null) return;
    setSaving(true);
    setError(null);
    void window.mage
      .writeProjectFile({ cwd, path: file.path, content: draft, expectedMtimeMs: loaded.mtimeMs })
      .then((content) => {
        setLoaded(content);
        setDraft(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? describeError(err) : String(err)))
      .finally(() => setSaving(false));
  };

  const openFolder = (): void => void window.mage.openPath(file.dir).catch(() => undefined);

  return (
    // Sin `flex-1`: aqui dentro el visor mide por su CONTENIDO y empuja hacia abajo los ficheros que
    // vienen detras, que es lo que se pidio. Estirarlo se comeria la lista entera.
    <div ref={rootRef} className="flex min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-[6px] border-b border-mg-border-subtle px-[10px] py-[5px]">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mg-sec" title={file.path}>
          {file.name}
        </span>
        {draft === null ? (
          <>
            <PanelButton onClick={load} label={t('chat.files.reloadFromDisk')}>
              ⟳
            </PanelButton>
            <PanelButton
              onClick={() => setDraft(loaded?.content ?? '')}
              label={t('chat.files.editFile', { name: file.name })}
              disabled={loaded === null || loaded.tooLarge || loaded.outsideCwd === true}
            >
              {t('chat.files.edit')}
            </PanelButton>
            <PanelButton onClick={openFolder} label={t('chat.files.openFolder')}>
              {t('chat.files.folder')}
            </PanelButton>
          </>
        ) : (
          <>
            <PanelButton onClick={save} label={t('chat.files.saveFile', { name: file.name })} disabled={saving} primary>
              {saving ? t('chat.files.saving') : t('chat.files.save')}
            </PanelButton>
            <PanelButton onClick={() => setDraft(null)} label={t('chat.files.discard')} disabled={saving}>
              {t('chat.files.cancel')}
            </PanelButton>
          </>
        )}
      </div>

      {gone && <GoneNotice />}

      {error !== null && (
        <div role="alert" className="flex shrink-0 items-start gap-[8px] border-b border-mg-danger-border bg-mg-danger-bg p-[8px_10px] text-[10.5px] text-mg-danger-ink">
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={load} className="shrink-0 underline decoration-dotted">
            {t('chat.files.reload')}
          </button>
        </div>
      )}

      <FileBody file={file} loaded={loaded} draft={draft} error={error} onDraftChange={setDraft} onApproveOutside={approveOutside} />
    </div>
  );
}

// El cuerpo: editor si se esta editando, y si no el contenido pintado (Markdown para .md, monospace
// para el resto). Separado del envoltorio para que el `return` temprano de cada estado (cargando, no
// existe, demasiado grande) no anide tres ternarios en el JSX de arriba.
function FileBody({
  file,
  loaded,
  draft,
  error,
  onDraftChange,
  onApproveOutside,
}: {
  readonly file: CreatedFile;
  readonly loaded: ProjectFileContent | null;
  readonly draft: string | null;
  readonly error: string | null;
  readonly onDraftChange: (value: string) => void;
  readonly onApproveOutside: () => void;
}): React.JSX.Element {
  const t = useT();
  if (draft !== null) {
    return (
      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        aria-label={t('chat.files.contentOf', { name: file.name })}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-mg-code p-[10px_12px] font-mono text-[11.5px] leading-[1.6] text-mg-body outline-none"
      />
    );
  }
  if (error !== null && loaded === null) return <div className="flex-1" />;
  if (loaded === null) return <Hint text={t('chat.files.loading')} />;
  if (loaded.outsideCwd === true) return <OutsideCwdHint path={loaded.path} onApprove={onApproveOutside} />;
  if (loaded.tooLarge) {
    return <Hint text={t('chat.files.tooLarge')} />;
  }
  if (loaded.content === null) {
    return <Hint text={t('chat.files.missing')} />;
  }
  if (loaded.content.trim().length === 0) return <Hint text={t('chat.files.empty')} />;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-[10px_12px] text-[12px] leading-[1.6]">
      {isMarkdown(file.name) ? (
        <Markdown text={loaded.content} />
      ) : (
        <HighlightedFile name={file.name} content={loaded.content} />
      )}
    </div>
  );
}

// Aviso de un fichero de fuera de la carpeta de la conversacion que el usuario aun no ha aprobado.
function OutsideCwdHint({ path, onApprove }: { readonly path: string; readonly onApprove: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <div data-outside-cwd="true" className="flex flex-col items-start gap-[8px] p-[14px] text-[11px] text-mg-muted">
      <span>{t('chat.files.outsideCwd')}</span>
      <span className="break-all font-mono text-[10.5px] text-mg-sec">{path}</span>
      <button
        onClick={onApprove}
        className="rounded-[6px] border border-mg-border-emph px-[10px] py-[4px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        {t('chat.files.openAnyway')}
      </button>
    </div>
  );
}

// Contenido de un fichero con resaltado de sintaxis. Reutiliza el MISMO resaltador que el chat
// (`useHighlightedCode` -> shiki en highlighter.ts): no hay un segundo resaltador en la app, y con el
// vienen gratis el tema activo (incluido uno importado de VS Code) y la carga perezosa de gramaticas.
// Componente propio y no un `if` dentro de `FileBody` porque el hook no puede ir detras de los
// `return` tempranos de aquel (cargando / no existe / vacio).
function HighlightedFile({ name, content }: { readonly name: string; readonly content: string }): React.JSX.Element {
  const lines = useHighlightedCode(content, langFromPath(name));
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.6] text-mg-body2">
      {lines === null ? content : <HighlightedLines lines={lines} />}
    </pre>
  );
}

function PanelButton({
  onClick,
  label,
  disabled = false,
  primary = false,
  children,
}: {
  readonly onClick: () => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const skin = primary
    ? 'bg-mg-primary font-semibold text-mg-primary-ink'
    : 'border border-mg-border-ctrl text-mg-body2 hover:bg-mg-hover';
  return (
    <button
      onClick={onClick}
      aria-label={label}
      data-tip={label}
      disabled={disabled}
      className={`shrink-0 rounded-[6px] px-[8px] py-[2px] text-[10.5px] disabled:opacity-40 ${skin}`}
    >
      {children}
    </button>
  );
}
