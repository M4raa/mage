import { lazy, Suspense, useEffect, useRef } from 'react';
import type { SplitLayout } from '@shared/state';
import { MIN_PANE_FRACTION, MIN_PANE_PX, type SplitPath } from './workbench/splitLayout';
import { TitleBar } from './workbench/components/TitleBar';
import { SplitPaneResizeHandle, SPLIT_A_VAR, SPLIT_B_VAR, splitRatioVars } from './workbench/components/SplitPaneResizeHandle';
import { AccountRail } from './workbench/components/AccountRail';
import { LeftDock } from './workbench/components/LeftDock';
import { TabBar } from './workbench/components/TabBar';
import { ChatPane } from './workbench/components/ChatPane';
import { RightDock, RightDockPanes } from './workbench/components/RightDock';
import { BottomDock } from './workbench/components/BottomDock';
import { StatusBar } from './workbench/components/StatusBar';
import { NotificationToasts } from './workbench/components/NotificationToasts';
import { TooltipLayer } from './workbench/components/TooltipLayer';
// El de confianza NO va perezoso, al reves que los demas dialogos: es lo que se interpone entre abrir
// una carpeta y ejecutar su codigo, y bloquea el arranque de la sesion. Cargarlo bajo demanda pondria
// una descarga de chunk en el camino critico de una frontera de seguridad.
import { TrustFolderDialog } from './workbench/components/TrustFolderDialog';
// El de cierre tampoco: main espera su respuesta para cerrar, y un chunk que no cargara dejaria la X
// sin efecto hasta recargar.
import { CloseMageDialog } from './workbench/components/CloseMageDialog';

// Los cuatro dialogos van en DIFERIDO (P15). Ya devolvian `null` cerrados, asi que la puerta de
// RENDER estaba bien; lo que faltaba era la de BUNDLE: `SettingsView` pasa de 1.400 lineas y arrastra
// `vscodeTheme`, `themeMarket`, `KEYBINDING_ACTIONS` y `HooksPermissionsSection` al chunk de
// arranque, para algo que el usuario abre de higos a brevas. Mismo patron que `PromptBar` ya usaba
// para CodeMirror. El `fallback` es `null` a proposito: un dialogo cerrado no pinta nada, asi que un
// spinner mientras carga el chunk seria un parpadeo donde antes no habia nada.
const NewTabDialog = lazy(() => import('./workbench/components/NewTabDialog').then((m) => ({ default: m.NewTabDialog })));
const AddAccountDialog = lazy(() => import('./workbench/components/AddAccountDialog').then((m) => ({ default: m.AddAccountDialog })));
const AccountSwitchDialog = lazy(() => import('./workbench/components/AccountSwitchDialog').then((m) => ({ default: m.AccountSwitchDialog })));
const HandoffModal = lazy(() => import('./workbench/components/HandoffModal').then((m) => ({ default: m.HandoffModal })));
import { OnboardingWizard } from './workbench/components/OnboardingWizard';

const SettingsView = lazy(() => import('./workbench/components/SettingsView').then((m) => ({ default: m.SettingsView })));
// Novedades, tambien en diferido: arrastra el changelog entero y casi nunca se abre.
// El de «actualización lista», en diferido: sale una vez por version.
const UpdateReadyDialog = lazy(() => import('./workbench/components/UpdateReadyDialog').then((m) => ({ default: m.UpdateReadyDialog })));
const ReleaseNotesPane = lazy(() => import('./workbench/components/ReleaseNotesPane').then((m) => ({ default: m.ReleaseNotesPane })));

import { useWorkbenchStore } from './workbench/workbenchStore';
import { RELEASE_NOTES_TAB_ID } from './workbench/releaseNotes';
import { usePanelLayoutStore } from './workbench/panelLayoutStore';
import { useGlobalKeybindings } from './workbench/keybindings/useGlobalKeybindings';

// Asidero de desarrollo para `pnpm verify:gui` (deja hidratar el chat sin gastar un turno real). El
// import es DINAMICO y bajo `import.meta.env.DEV`, que Vite reemplaza por `false` al construir: la rama
// —y con ella el modulo— desaparecen del bundle de produccion.
if (import.meta.env.DEV) void import('./workbench/devBridge');

// Periodicidad del polling lento de uso/estado (ms). Alineado con la caché de main (>=180 s): pedir
// mas a menudo devolveria caché, no datos frescos (el endpoint de uso es grueso y con lag).
const USAGE_POLL_MS = 180_000;

// Periodicidad del refresco del HISTORIAL de conversaciones. Hasta el 2026-09-18 la lista solo se
// refrescaba ante eventos de ESTA ventana (terminar un turno, cambiar de cuenta, cerrar una pestaña,
// arrancar), asi que no se enteraba de nada escrito por fuera: otra ventana de Mage —que ahora las
// hay— o el propio CLI en una terminal. Se reconstruye leyendo el directorio de la cuenta activa, o
// sea disco: 30 s es suficiente para que se note vivo sin estar paseando por el FS sin parar, y solo
// corre con la ventana VISIBLE.
const HISTORY_POLL_MS = 30_000;

// Nombre de la marca de arranque. Lo lee `scripts/verify-gui.mjs`; si cambia aqui, cambia alli.
export const WORKBENCH_MOUNTED_MARK = 'mage:workbench-mounted';

// Centro del workbench: uno o N paneles de conversacion (Ronda 3 item 13, generalizado a un arbol de
// divisiones binarias en I11). La barra de pestañas es una sola y comun a todos (la pestaña activa de
// la barra es la del panel ENFOCADO); lo que se divide es el area de chat+prompt, que es donde el
// usuario queria ver varias conversaciones a la vez.
function SplitCenter(): React.JSX.Element {
  const splitLayout = useWorkbenchStore((s) => s.splitLayout);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  return <SplitLayoutView layout={splitLayout} path={[]} activeTabId={activeTabId} hasSplit={splitLayout.kind !== 'leaf'} />;
}

// Minimo de un panel EN EL EJE DE LA DIVISION, impuesto por el LAYOUT y no solo por el arrastre.
// `clampRatioForSize` (splitLayout.ts) solo entra al mover el divisor; al encoger la VENTANA nadie
// re-acotaba nada y los paneles llevaban `min-w-0`, que es literalmente "puedes encogerte a cero".
//
// El `min()` de CSS es lo que evita el otro extremo: exigir 320 px siempre haria que dos paneles
// pidieran 640 px en una ventana de 500 y el contenedor desbordaria (scroll horizontal de TODA la app,
// que es peor que lo que se venia a arreglar). Con `min(320px, 25%)` el minimo absoluto manda mientras
// quepa —a partir de un contenedor de 1280 px— y por debajo cede al mismo suelo PROPORCIONAL que usa
// `clampRatioForSize` (`MIN_PANE_FRACTION`), que nunca puede desbordar (dos paneles = 50%).
const PANE_MIN_CSS = `min(${MIN_PANE_PX}px, ${MIN_PANE_FRACTION * 100}%)`;

// Un nodo del arbol: una hoja es un `ChatPane`; una division renderiza sus dos lados con el reparto
// (`ratio`) actual y un divisor arrastrable entre medias. `path` es el camino desde la raiz — lo que
// `resizeSplitAt`/las acciones del store necesitan para tocar SOLO este nodo (I11).
function SplitLayoutView({
  layout,
  path,
  activeTabId,
  hasSplit,
}: {
  readonly layout: SplitLayout;
  readonly path: SplitPath;
  readonly activeTabId: string;
  readonly hasSplit: boolean;
}): React.JSX.Element {
  const resizeSplitAt = useWorkbenchStore((s) => s.resizeSplitAt);
  const containerRef = useRef<HTMLDivElement>(null);

  if (layout.kind === 'leaf') {
    // Cada hoja es un GRUPO: su propia barra de pestañas encima de su panel. Antes la barra era una
    // sola y comun, asi que al dividir los dos paneles obedecian a la misma lista — que es justo lo
    // que el usuario pidio arreglar ("cada espacio reacciona a su barra de pestañas").
    // El redondeo y el recorte viven AQUI y no en el contenedor del centro (peticion del usuario,
    // 2026-09-20): con el radio puesto solo fuera, al dividir salian dos rectangulos pegados dentro de
    // una caja redondeada — solo las dos esquinas de los extremos se veian curvas. Cada espacio de
    // trabajo (su barra de pestañas y su chat) es una ventana flotante con sus cuatro esquinas.
    return (
      <div
        // Ancla del harness: medir "la ventana de este panel" por el padre de su barra de pestañas
        // acababa midiendo el scroller de la barra (medido: radio 0 y una caja que no era la del panel).
        data-workspace="pane"
        // El BORDE es lo que hace que se lea como ventana: el hueco de 3 px es del color del shell
        // (`--color-mg-window`) y el panel tambien, asi que sin filete no habia nada que distinguir y el
        // conjunto seguia pareciendo una superficie plana con una raya. Con el, cada espacio tiene
        // contorno propio y el redondeo se ve.
        className="mg-island flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-mg-border bg-mg-window"
      >
        <TabBar tabIds={layout.tabIds} paneActiveTabId={layout.activeTabId} path={path} />
        {/* La pseudo-pestaña de novedades no es una conversacion: su panel no lleva chat ni prompt. */}
        {layout.activeTabId === RELEASE_NOTES_TAB_ID ? (
          <Suspense fallback={null}>
            <ReleaseNotesPane focused={layout.activeTabId === activeTabId} split={hasSplit} />
          </Suspense>
        ) : (
          <ChatPane tabId={layout.activeTabId} focused={layout.activeTabId === activeTabId} split={hasSplit} path={path} />
        )}
      </div>
    );
  }
  // El `min-w-0`/`min-h-0` se conserva en el eje TRANSVERSAL (ahi sigue estando por lo que estaba: que
  // el contenido no desborde); en el eje de la division lo sustituye el minimo REAL en pixeles.
  const paneClass = layout.direction === 'row' ? 'flex min-h-0' : 'flex min-w-0';
  const paneMin: React.CSSProperties = layout.direction === 'row' ? { minWidth: PANE_MIN_CSS } : { minHeight: PANE_MIN_CSS };
  return (
    // El reparto viaja por variables CSS (`splitRatioVars`) en vez de por dos numeros inline: asi el
    // arrastre puede moverlo en vivo sobre este nodo sin pasar por el store (ver SplitPaneResizeHandle).
    // Cada division declara las suyas, de modo que una anidada sombrea a la de arriba por herencia.
    <div
      ref={containerRef}
      style={splitRatioVars(layout.ratio)}
      // `gap-[3px]`: el mismo hueco que separa las islas del shell. Sin el, las dos ventanas quedan
      // pegadas por la divisoria de 1 px y sus esquinas interiores se tocan.
      className={`flex min-h-0 min-w-0 flex-1 gap-[3px] ${layout.direction === 'row' ? 'flex-row' : 'flex-col'}`}
    >
      <div className={paneClass} style={{ ...paneMin, flexGrow: `var(${SPLIT_A_VAR})`, flexBasis: 0 }}>
        <SplitLayoutView layout={layout.a} path={[...path, 'a']} activeTabId={activeTabId} hasSplit={hasSplit} />
      </div>
      <SplitPaneResizeHandle
        direction={layout.direction}
        ratio={layout.ratio}
        containerRef={containerRef}
        onCommit={(ratio) => {
          const caja = containerRef.current?.getBoundingClientRect();
          const total = caja === undefined ? 0 : layout.direction === 'row' ? caja.width : caja.height;
          resizeSplitAt(path, ratio, total);
        }}
        ariaLabel="Redimensionar la división de paneles"
      />
      <div className={paneClass} style={{ ...paneMin, flexGrow: `var(${SPLIT_B_VAR})`, flexBasis: 0 }}>
        <SplitLayoutView layout={layout.b} path={[...path, 'b']} activeTabId={activeTabId} hasSplit={hasSplit} />
      </div>
    </div>
  );
}

// Ventana principal de Mage — Workbench (handoff 3a). Columna de alto completo: fila principal
// (rail · sidebar · centro · inspector) + barra de estado.
export function App(): React.JSX.Element {
  const init = useWorkbenchStore((s) => s.init);
  const initPanelLayout = usePanelLayoutStore((s) => s.init);
  const themePref = useWorkbenchStore((s) => s.settings.theme);
  // Marca de arranque para `pnpm verify:gui` (fase 0.2 de la auditoria): deja medir cuanto tarda el
  // workbench en montar sin instrumentar el harness por fuera. `performance.mark` es API estandar del
  // navegador y cuesta microsegundos, asi que se deja tambien en produccion: sin ella, una regresion
  // de arranque solo se nota a ojo. Se compara contra `navigationStart` (entrada de tipo navigation).
  useEffect(() => {
    performance.mark(WORKBENCH_MOUNTED_MARK);
  }, []);
  // Al montar: suscribe el store al stream del motor y carga las cuentas reales (una vez).
  useEffect(() => init(), [init]);
  // Layout de paneles acoplables (F6 Fase 4): carga async por IPC: NUNCA roba el foco al hidratar
  // (§6) — el store ya pinta con los defaults sincronos del registro hasta que esto resuelva.
  useEffect(() => initPanelLayout(), [initPanelLayout]);
  // Atajos de teclado de scope 'global' (D5): funcionan sin importar donde este el foco.
  useGlobalKeybindings();
  // Con preferencia 'system', seguir al SO en caliente: al cambiar prefers-color-scheme, re-resolver y
  // re-aplicar via setTheme('system'). Solo se suscribe mientras la preferencia sea 'system'.
  useEffect(() => {
    if (themePref !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => useWorkbenchStore.getState().setTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [themePref]);
  // Al recuperar el foco (p.ej. tras el login en la terminal externa), re-descubre las cuentas para
  // reflejar el nuevo estado de login sin pulsar Refrescar, y refresca uso/estado. getState evita
  // re-suscribir el listener.
  useEffect(() => {
    const onFocus = (): void => {
      const store = useWorkbenchStore.getState();
      void store.refreshAccounts().then(() => store.refreshActiveUsage());
      void store.refreshStatus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  // Polling lento (>= caché de main) del uso de la cuenta activa y del estado, solo con la ventana
  // visible. El main cachea >=180 s, asi que este intervalo no golpea la red de mas.
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState !== 'visible') return;
      const store = useWorkbenchStore.getState();
      void store.refreshActiveUsage();
      void store.refreshStatus();
    };
    const id = window.setInterval(tick, USAGE_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // El historial, por su cuenta y mas a menudo: cambia por cosas que pasan FUERA de esta ventana.
  // Mismo guard de visibilidad — una ventana en segundo plano no tiene por que tocar el disco.
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState !== 'visible') return;
      void useWorkbenchStore.getState().loadConversationHistory();
    };
    const id = window.setInterval(tick, HISTORY_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex h-full flex-col bg-mg-window text-mg-body">
      <TitleBar />
      {/* El hueco de 3px es lo que HACE VISIBLE el redondeo de las islas: hasta ahora se separaban con
          un borde de 1px, asi que una esquina redondeada quedaba tapada por la isla de al lado y el
          radio no se notaba. El fondo que asoma por las juntas es `bg-mg-window`, el mismo del shell.
          El hueco es AHORA tambien vertical (`py`): con el redondeo puesto pero pegadas arriba a la
          barra de titulo y abajo a la de estado —que son de otro color—, las esquinas de arriba y de
          abajo se leian como angulos rectos. Una isla que toca el borde no parece flotar.

          MARCO CONTINUO (2026-09-21, feedback del usuario: "los menús laterales siguen siendo un ángulo
          recto"). Los rails NO se redondean: se funden con la barra de titulo y la de estado —las tres
          piezas ya compartian el token `bg-mg-rail`— y forman UN marco de una pieza con las islas
          redondeadas flotando dentro. Por eso esta fila ya NO lleva padding: los rails tienen que tocar
          arriba, abajo y su borde de la ventana. El hueco de 3px baja a la columna de contenido. */}
      <div className="flex min-h-0 flex-1">
        <AccountRail />
        {/* Columna de contenido: lo que queda DENTRO del marco. El borde compartido de abajo vive aqui
            dentro, asi que ahora abarca el ancho util entre los dos rails en vez de pasar por debajo de
            ellos — que es lo que hace que el marco se lea como un marco y no como una U. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 gap-[3px] p-[3px]">
            <LeftDock />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-mg-window">
              <SplitCenter />
            </div>
            <RightDockPanes />
          </div>
          {/* El borde inferior es otra isla: con el mismo hueco a los lados y abajo que el resto. */}
          <div className="flex shrink-0 p-[0_3px_3px]">
            <BottomDock />
          </div>
        </div>
        <RightDock />
      </div>
      <StatusBar />
      {/* Detras de la barra de estado en el orden de Tab: se llega a los toasts sin atajo propio. */}
      <NotificationToasts />
      <Suspense fallback={null}>
        <NewTabDialog />
        <AddAccountDialog />
        <HandoffModal />
        <AccountSwitchDialog />
        <SettingsView />
        <UpdateReadyDialog />
      </Suspense>
      <TrustFolderDialog />
      {/* Asistente de primer arranque: se monta SIEMPRE y el decide si hay algo que enseñar (solo
          mientras `onboardingCompletedVersion` este por detras de la version del asistente). Va por
          encima del resto de dialogos: es lo primero que ve alguien con una instalacion limpia. */}
      <OnboardingWizard />
      <CloseMageDialog />
      <TooltipLayer />
    </div>
  );
}
