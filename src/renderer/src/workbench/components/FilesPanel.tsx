import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HighlightedLines } from './Markdown';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { createdFilesOf, type CreatedFile } from '../createdFilesView';
import { Markdown } from './Markdown';
import { Hint } from './TranscriptHint';
import { useHighlightedCode } from '../highlighter';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { langFromPath } from '../codeHighlight';
import type { Block } from '../types';
import type { ProjectFileContent } from '@shared/ipc';

// Panel "Ficheros" (2.10, peticion del usuario: "si creas un plan .md .txt o lo que sea tiene que
// aparecer a la derecha como un artifact y así poder ver el plan, poder editarlo").
//
// Tres decisiones que explican la forma de esto:
//
//  - La LISTA sale de los bloques del chat (`createdFilesOf`), no de un registro nuevo. Igual que el
//    panel de Artifacts, y por lo mismo: los bloques se hidratan desde la transcripcion al reabrir la
//    conversacion, asi que la lista sale completa tambien en una conversacion de hace un mes.
//  - El CONTENIDO se lee de DISCO, no del `writtenContent` del bloque. El fichero pudo cambiar despues
//    de crearse (lo edito el agente, o el usuario en su editor): ensenar el input de la tool seria
//    ensenar el pasado y, sobre todo, guardarlo encima pisaria lo que hay.
//  - Guardar es un COMPARE-AND-SWAP por mtime (lo hace main): si el fichero cambio desde que se leyo,
//    el guardado se RECHAZA con un mensaje y un boton de recargar. Nunca se pisa en silencio.
const EMPTY_BLOCKS: readonly Block[] = [];

// Extensiones que se pintan como Markdown. El resto va en monospace tal cual: adivinar el formato de un
// fichero por su contenido es una fuente de sorpresas, y aqui el objetivo es LEER lo que hay.
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function FilesPanel(): React.JSX.Element {
  const tabId = usePaneTabId();
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY_BLOCKS);
  const cwd = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId)?.cwd ?? null);
  const files = useMemo(() => createdFilesOf(blocks), [blocks]);
  // TRES estados, no dos, y cada uno significa algo distinto:
  //   undefined -> nadie ha elegido todavia; se abre el primero, como ha hecho siempre el panel.
  //   '<ruta>'  -> ese fichero, abierto a mano.
  //   null      -> CERRADO a mano (2026-09-21, feedback del usuario: "al volver a hacer clic sobre un
  //                archivo abierto, este no se cierra"). Sin este tercer estado no se puede distinguir
  //                "no ha elegido" de "ha elegido que no haya ninguno", y el `?? files[0]` de abajo
  //                reabria el primero en cuanto se cerraba el que estaba mirando.
  const [selectedPath, setSelectedPath] = useState<string | null | undefined>(undefined);

  // El seleccionado por defecto es el ULTIMO creado, y cambia solo si el que estaba seleccionado
  // desaparece de la lista (otra conversacion, hilo recargado): reelegirlo en cada escritura del agente
  // sacaria de la pantalla el fichero que el usuario esta leyendo. Cerrado a mano manda sobre todo eso:
  // el panel no vuelve a abrir nada por su cuenta hasta que se pulse otro fichero.
  const selected = selectedPath === null ? null : (files.find((f) => f.path === selectedPath) ?? files[0] ?? null);

  // Pulsar el que ya esta abierto lo CIERRA; pulsar otro cambia de fichero.
  const toggle = (path: string): void => setSelectedPath(selected?.path === path ? null : path);

  if (cwd === null) return <Hint text="Abre una conversación para ver los ficheros que ha creado." />;
  if (files.length === 0) {
    return <Hint text="Esta conversación todavía no ha creado ningún fichero." />;
  }

  return (
    // Ancla ESTABLE para `pnpm verify:gui`: los avisos (`role="alert"`) de este panel hay que medirlos
    // POR AMBITO — el hilo y el prompt tienen los suyos, y un scan global del documento se traia el
    // error de un adjunto rechazado de tres comprobaciones antes. No la usa ningun codigo de produccion.
    <div data-files-panel="true" className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-mg-border-subtle px-[10px] py-[6px] text-[10px] text-mg-ter">
        <span className="font-bold tracking-[.06em]">FICHEROS CREADOS ({files.length})</span>
      </div>
      {/* La lista ES el panel: `flex-1` en vez del `max-h-[35%]` de antes. El visor se pinta DENTRO del
          <li> del fichero elegido (2026-09-21, feedback del usuario: "el archivo que clico se renderiza
          abajo del todo en vez de justo debajo del propio archivo y desplazando el resto"), asi que lo
          que scrollea tiene que ser el conjunto lista+visor, no una cajita del 35% con el visor colgando
          por debajo. */}
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto p-[6px]">
        {files.map((file) => (
          <li key={file.path} className="flex min-w-0 flex-col">
            <button
              onClick={() => toggle(file.path)}
              aria-pressed={file.path === selected?.path}
              aria-expanded={file.path === selected?.path}
              data-created-file={file.path}
              className={`flex w-full flex-col items-start gap-[1px] rounded-[6px] px-[8px] py-[5px] text-left ${
                file.path === selected?.path ? 'bg-mg-sel' : 'hover:bg-mg-hover'
              }`}
            >
              <span className="flex w-full items-center gap-[6px]">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-mg-body">{file.name}</span>
                {file.failed && (
                  <span className="shrink-0 text-[10px] text-mg-danger" title="La escritura falló">
                    falló
                  </span>
                )}
              </span>
              <span className="w-full truncate text-[10px] text-mg-muted">{file.dir}</span>
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
              {file.path === selected?.path && (
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
                    <FileViewer key={file.path} file={file} cwd={cwd} askOutside={selectedPath === file.path} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Visor/editor de UN fichero. `key={path}` en el caller: al cambiar de fichero se monta uno nuevo, asi
// que no hace falta reiniciar a mano el borrador, el modo de edicion ni el error.
function FileViewer({
  file,
  cwd,
  askOutside,
}: {
  readonly file: CreatedFile;
  readonly cwd: string;
  readonly askOutside: boolean;
}): React.JSX.Element {
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [cwd, file.path]);

  useEffect(load, [load]);

  // Fuera de la carpeta de la conversacion (P-028, 15): la pregunta la hace main con un dialogo nativo
  // y, si se aprueba, se vuelve a leer. Cancelar deja el aviso con «Abrir de todos modos…».
  const approveOutside = useCallback(() => {
    void window.mage
      .approveProjectFileOutside({ cwd, path: file.path })
      .then((approved) => {
        if (approved) load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  const openFolder = (): void => void window.mage.openPath(file.dir).catch(() => undefined);

  return (
    // Sin `flex-1`: aqui dentro el visor mide por su CONTENIDO y empuja hacia abajo los ficheros que
    // vienen detras, que es lo que se pidio. Estirarlo se comeria la lista entera.
    <div className="flex min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-[6px] border-b border-mg-border-subtle px-[10px] py-[5px]">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mg-sec" title={file.path}>
          {file.name}
        </span>
        {draft === null ? (
          <>
            <PanelButton onClick={load} label="Recargar del disco">
              ⟳
            </PanelButton>
            <PanelButton
              onClick={() => setDraft(loaded?.content ?? '')}
              label={`Editar ${file.name}`}
              disabled={loaded === null || loaded.tooLarge || loaded.outsideCwd === true}
            >
              Editar
            </PanelButton>
            <PanelButton onClick={openFolder} label="Abrir la carpeta del fichero">
              Carpeta
            </PanelButton>
          </>
        ) : (
          <>
            <PanelButton onClick={save} label={`Guardar ${file.name}`} disabled={saving} primary>
              {saving ? 'Guardando…' : 'Guardar'}
            </PanelButton>
            <PanelButton onClick={() => setDraft(null)} label="Descartar los cambios" disabled={saving}>
              Cancelar
            </PanelButton>
          </>
        )}
      </div>

      {error !== null && (
        <div role="alert" className="flex shrink-0 items-start gap-[8px] border-b border-mg-danger-border bg-mg-danger-bg p-[8px_10px] text-[10.5px] text-mg-danger-ink">
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={load} className="shrink-0 underline decoration-dotted">
            Recargar
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
  if (draft !== null) {
    return (
      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        aria-label={`Contenido de ${file.name}`}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-mg-code p-[10px_12px] font-mono text-[11.5px] leading-[1.6] text-mg-body outline-none"
      />
    );
  }
  if (error !== null && loaded === null) return <div className="flex-1" />;
  if (loaded === null) return <Hint text="Cargando…" />;
  if (loaded.outsideCwd === true) return <OutsideCwdHint path={loaded.path} onApprove={onApproveOutside} />;
  if (loaded.tooLarge) {
    return <Hint text="El fichero es demasiado grande para verlo aquí. Ábrelo en tu editor." />;
  }
  if (loaded.content === null) {
    return <Hint text="El fichero ya no está en disco (se movió o se borró después de crearlo)." />;
  }
  if (loaded.content.trim().length === 0) return <Hint text="El fichero está vacío." />;
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
  return (
    <div data-outside-cwd="true" className="flex flex-col items-start gap-[8px] p-[14px] text-[11px] text-mg-muted">
      <span>Este fichero está fuera de la carpeta de la conversación:</span>
      <span className="break-all font-mono text-[10.5px] text-mg-sec">{path}</span>
      <button
        onClick={onApprove}
        className="rounded-[6px] border border-mg-border-emph px-[10px] py-[4px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        Abrir de todos modos…
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
