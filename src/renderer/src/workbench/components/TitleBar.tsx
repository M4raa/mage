import { useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { MageMark } from './MageMark';
import { AppMenu } from './AppMenu';
import { AccountSwitcher } from './AccountSwitcher';
import { Icon } from './Icon';
import { buildBugReportUrl } from '../bugReport';

// Ancho que reserva Windows para sus tres botones de sistema (minimizar/maximizar/cerrar) en la franja
// de `titleBarOverlay`. Se deja libre a la derecha: cualquier cosa pintada debajo seria inalcanzable.
const WINDOWS_CONTROLS_WIDTH_PX = 138;
// macOS dibuja sus semaforos a la IZQUIERDA y tampoco admite overlay: alli el hueco va al otro lado.
const MAC_TRAFFIC_LIGHTS_WIDTH_PX = 78;

const isMac = navigator.platform.toLowerCase().includes('mac');

// El boton de "Preferencias" que habia aqui a la derecha desaparecio (peticion del usuario: "eso tiene
// que ir dentro de los 3 puntitos"). No hubo que moverlo: `app.openSettings` es una accion del catalogo
// con categoria "Aplicación", asi que el menu propio YA la generaba dentro de "Conversación" — el boton
// era una tercera copia de la misma accion. Quedan dos puertas, y las dos se pidieron: el menu y el
// icono de la app de la esquina.
//
// Cabecera propia de la ventana (Ronda 3, item 9: "el tema no afecta a la titlebar ni al menú
// Editar"). La barra nativa vive fuera del DOM y ningun tema podia alcanzarla; esta es HTML normal, asi
// que hereda los tokens del tema como el resto de la app — incluidos los importados de Open VSX.
//
// Dos piezas que NO son DOM y se resuelven aparte:
// - Los tres botones de sistema los sigue pintando el SO (franja `titleBarOverlay`), recoloreada en
//   caliente desde theme.ts. Por eso aqui se reserva su ancho a la derecha.
// - El menu de aplicacion ya NO es el `Menu` nativo (2.9.b): es `AppMenu`, HTML normal generado del
//   catalogo de acciones, asi que tambien hereda el tema. El nativo se conserva solo en macOS, donde la
//   barra la pinta el SO y sus roles de edicion son los que hacen funcionar Cmd+C/Cmd+V.
export function TitleBar(): React.JSX.Element {
  const openSettings = useWorkbenchStore((s) => s.openSettings);
  // El menu desplegado SUSTITUYE al resto de la cabecera (cuentas y Preferencias) en vez de añadirse y
  // empujarlo a la derecha — peticion explicita del usuario tras el primer intento, y es como se
  // comporta IntelliJ: pulsar el boton de menu cambia la barra, no la alarga.
  const [menuExpanded, setMenuExpanded] = useState(false);

  return (
    <div
      // Ancla del harness: la cabecera propia es contra lo que se mide el hueco superior de las islas
      // (un `header` a secas casaba con la cabecera del panel de conversaciones).
      data-titlebar=""
      // `app-region: drag` hace arrastrable la cabecera (como la nativa que sustituye); cada control
      // interactivo la desactiva con `no-drag`, si no el clic se lo comeria el arrastre de ventana.
      style={{
        height: TITLE_BAR_HEIGHT_PX,
        WebkitAppRegion: 'drag',
        paddingLeft: isMac ? MAC_TRAFFIC_LIGHTS_WIDTH_PX : 10,
        paddingRight: isMac ? 10 : WINDOWS_CONTROLS_WIDTH_PX,
      } as React.CSSProperties}
      className="flex shrink-0 items-center gap-[10px] border-b border-mg-border bg-mg-rail text-[11px] text-mg-sec"
    >
      {/* 2.9.a: el logo en lugar del texto "MAGE". Y desde 2026-09-07 es tambien el ACCESO a los
          ajustes (peticion del usuario), que es lo que hace el icono de la esquina en tantas apps: el
          engranaje del rail izquierdo desaparecio y esta es su unica puerta junto al menu y Ctrl+,.
          Por eso pasa de imagen decorativa a boton, con su nombre accesible y su atajo en el tooltip. */}
      <button
        onClick={openSettings}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        data-tip="Mage · Configuración (Ctrl+,)"
        // El nombre lleva "Mage" a proposito: este control es el UNICO sitio de la ventana donde
        // aparece el nombre de la app desde que el texto "MAGE" se sustituyo por el logo, y al
        // convertirlo en boton de ajustes se perdio — lo canto la comprobacion de GUI, no el ojo.
        aria-label="Mage · Configuración"
        className="flex shrink-0 items-center rounded-[5px] p-[3px] text-mg-sec transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body"
      >
        <MageMark size={18} />
      </button>
      {/* Menu de aplicacion PROPIO (2.9.b), generado del catalogo de acciones. Sustituye al `Menu`
          nativo, que ya solo existe en macOS y solo por sus roles de edicion (ver main/index.ts). */}
      <AppMenu expanded={menuExpanded} onExpandedChange={setMenuExpanded} />
      {/* Con el menu desplegado, la barra es SOLO el menu. Lo demas no se oculta con CSS sino que no se
          monta: un `hidden` dejaria sus controles alcanzables por teclado detras del menu. */}
      {!menuExpanded && (
        <>
          <AccountSwitcher />
          <div className="flex-1" />
          <BugReportButton />
        </>
      )}
    </div>
  );
}

// Informar de un fallo, pegado a la IZQUIERDA de los botones del SO. No puede ir entre ellos: esa
// franja la pinta Windows y aqui solo se reserva su ancho (ver WINDOWS_CONTROLS_WIDTH_PX), asi que
// cualquier cosa dibujada debajo seria inalcanzable. Este es el sitio mas cercano que existe.
//
// La version se pide AL PULSAR, no al montar: `getAbout()` trae ademas el texto ENTERO de
// THIRD-PARTY-NOTICES.txt (85 dependencias), y cruzar eso por IPC en cada arranque de la ventana para
// leer un numero de version seria pagar un fichero por un dato. Aqui se paga solo quien informa.
function BugReportButton(): React.JSX.Element {
  const openReport = (): void => {
    void window.mage
      .getAbout()
      // Que «Acerca de» falle NO impide informar: se abre el formulario sin la version, que es un
      // campo que la persona puede rellenar a mano, y el fallo se avisa por consola.
      .catch((err: unknown) => {
        console.warn('No se pudo leer la versión para el informe de fallo:', err);
        return null;
      })
      .then((about) =>
        window.mage.openExternal(
          buildBugReportUrl({ appVersion: about?.versions.app ?? null, platform: navigator.platform }),
        ),
      )
      .catch((err: unknown) => console.warn('No se pudo abrir el informe de fallo:', err));
  };

  return (
    <button
      onClick={openReport}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      data-tip="Informar de un fallo en GitHub"
      // Dice que ABRE EL NAVEGADOR: el control se va de la app, y eso se anuncia antes de pulsarlo.
      aria-label="Informar de un fallo (abre GitHub en el navegador)"
      className="flex shrink-0 items-center rounded-[5px] p-[3px] text-mg-sec transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body"
    >
      <Icon name="bug" size={15} />
    </button>
  );
}

// Debe coincidir con TITLE_BAR_HEIGHT_PX de main/index.ts (el alto que se le pide a la franja de
// botones del SO): si difieren, los botones quedan escalonados respecto a esta cabecera.
const TITLE_BAR_HEIGHT_PX = 32;
