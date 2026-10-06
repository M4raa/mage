---
name: verificacion-gui
description: Cómo verificar cambios de UI de Mage por CDP/Playwright y evitar las trampas ya medidas de aislamiento, animaciones y HMR. Úsalo antes de declarar verificado cualquier cambio visible.
---

# Verificación GUI de Mage (por CDP)

> **Antes que nada: `pnpm verify:gui`.** El harness versionado ya cubre más de cien comprobaciones y es el
> arranque por defecto — `CLAUDE.md` prohíbe expresamente escribir un driver CDP desechable. Lo que
> sigue describe cómo conducir la app a mano, que es la EXCEPCIÓN: sirve para diagnosticar algo que el
> harness aún no mide, y lo que se aprenda ahí termina siendo una comprobación nueva dentro de
> `scripts/verify-gui.mjs`, no un fichero suelto. Un driver de usar y tirar en la raíz del repo es lo
> que este harness vino a sustituir.


Un agente headless no puede pilotar la ventana de Electron a ojo, pero **sí** puede medir el DOM real.
La regla del proyecto: *"verifica end-to-end (arranca lo construido, no solo tests)"*. Los tests en
verde no son verificación de UI.

## Arranque

```bash
pnpm dev -- --remote-debugging-port=9222
```

Luego un driver Playwright/CDP que se conecte a `http://127.0.0.1:9222`.

## Los errores que YA se cometieron

### 1. El driver no puede vivir en el scratchpad

`playwright-core` no resuelve módulos desde fuera del árbol del proyecto. El driver tiene que estar
**dentro del repo** (p. ej. `_cdp_*.mjs` en la raíz, nunca trackeado) y borrarse al terminar. Las
capturas y los JSON de resultados sí van al scratchpad.

### 2. Selectores demasiado amplios activaron una cuenta ajena

Contando entre **31 pestañas abiertas de cuentas reales**, un `querySelectorAll` optimista activó por
accidente la pestaña de otra cuenta. Se revirtió, pero es un incidente real con datos reales.

- Ancla siempre por `aria-label`, `role` + nombre accesible, o `data-*` explícito.
- Verifica el **conteo** que esperas antes de clicar: si esperas 1 y hay 31, no clices.
- Antes de tocar nada, guarda cuál es la cuenta/pestaña activa para poder volver.

### 3. Un solo `Enter` que envía, y es el del turno mínimo

Pulsar `Enter` con texto en el prompt dispara un **turno real** del agente: gasta suscripción y escribe
en una transcripción de verdad. Por eso `verify:gui` envía **uno y solo uno** por ejecución, en su
última comprobación («turno mínimo de verdad»), con estas guardas:

- Claude con el modelo y el esfuerzo más bajos (`haiku`, `low`) y una respuesta de una palabra.
- Antes de nada lee el uso de la cuenta: con **más del 70 % gastado** avisa y deja elegir entre real y
  local (un servidor falso OpenAI-compatible, `scripts/fake-openai-server.mjs`, por el runtime propio de Mage). Sin
  terminal interactiva elige local y lo dice en el informe; un uso que no se puede leer cuenta como
  «por encima». `--turn=local` o `--turn=real` fuerzan uno.
- Antes de pulsar `Enter` **afirma el proveedor y el modelo de la pestaña activa**; si no son los
  esperados, no envía.

Fuera de esa comprobación la regla sigue igual: para probar el input, usa teclas que no envían (`Tab`,
`Shift+Tab`, `Escape`) y comprueba el valor del editor, no el envío. Y a mano, contra tu perfil real,
nunca.

### 4. Residuo de máquina disfrazado de bug

Un `panels-layout.json` viejo produjo paneles **duplicados** que parecían un fallo de
`reconcileLayoutWithRegistry` y no lo eran. Ver la skill `tocar-main`. Ante algo raro en el layout:
borra el fichero de estado y reinicia limpio **antes** de diagnosticar.

### 5. Una comprobación que cierra un diálogo rompe a las siguientes

En `verify:gui` las comprobaciones comparten la misma ventana y se ejecutan en orden. Una nueva cerró
con `Escape` el diálogo de Configuración al terminar y tumbó a las **dos** de después, que llegaban
esperándolo abierto — con una excepción (`locator.focus: Timeout`) que no se parecía nada a la causa.
Contrato: **quien llega con un diálogo abierto lo deja abierto; quien abre el suyo, lo cierra.** Y al
añadir una comprobación, mira qué estado deja para la siguiente (una pestaña nueva, un panel dividido,
un modelo cambiado): déjalo como lo encontraste o ponla la última.

### 6. Esperar a un modal con un tiempo fijo da medidas distintas según la ejecución

Una comprobación contaba `2` recuadros de aviso unas veces y `1` otras: mientras corría la **animación
de salida** del diálogo, su aviso seguía en el DOM y se sumaba al de la pantalla de debajo. Espera al
**desmontaje** (`waitFor({ state: 'detached' })`), no a un `waitForTimeout`. Un intermitente en el
harness es peor que una comprobación de menos: enseña a desconfiar del informe.

## Qué cuenta como verificado

Mide, no mires. Ejemplos reales de este proyecto:

- `getBoundingClientRect()` para alineaciones (`pane.left=853` vs `footer.left=850` fue un bug real de
  3px que a ojo no se veía).
- Contar nodos del DOM antes/después para afirmar que algo se montó o desmontó.
- Leer `aria-valuenow` de un `role="separator"` para comprobar un resize por teclado.
- Leer el fichero en disco tras un guardado, no fiarse del "Guardado ✓" de la UI.

## Lo que un driver NO puede hacer

Juzgar si el resultado **se ve bien**. Eso lo da el usuario. Reporta siempre "verificado por CDP
(medidas X, Y, Z); pendiente el vistazo humano", nunca "verificado" a secas.

## Limpieza

Al terminar: borra el driver del repo, cierra los procesos de Electron que hayas lanzado, y elimina
cualquier fichero de prueba que hayas creado (p. ej. en `shared-config/`). Está en la cultura del
proyecto y en varias entradas del ROADMAP.

### 7. Editar el código fuente MIENTRAS corre `verify:gui`

El harness arranca la app con `electron-vite dev`, o sea **con HMR**. Tocar un fichero del renderer
durante la ejecución recarga el módulo en caliente a mitad de la tanda; si además el fichero pasa por
un estado con error de sintaxis (cosa normal mientras se edita), el renderer se queda roto y a partir
de ahí *todo* falla con `window.__mageDev no existe` y `no existe la marca mage:workbench-mounted`.

Pasó el 2026-09-18: **47/96**, con ~35 comprobaciones cayendo por eso, en un árbol que minutos antes
daba 95/96. El informe describe un desastre que no existe.

Regla: **mientras `verify:gui` corre no se toca `src/`.** Se lanza al terminar de editar, no antes. Si
hace falta seguir trabajando, se espera — son diez minutos, y un informe que miente cuesta más.

### 8. Pasar en la tanda no demuestra que el caso prepare su estado

El 2026-10-06 el encabezado decorado pasaba tras Ctrl+N y fallaba solo (`documento=""`): estaba
tecleando en la pantalla sin conversación. También había casos que consumían Configuración abierta,
Ollama creado por otro caso o dos pestañas con títulos distintos.

Cada caso pasa por `runGuiCheck` (`scripts/lib/guiCheckState.mjs`), con el límite
`withGuiState` **capture → prepare → run → restore**, incluida la preparación fallida. Declara en
`state` las precondiciones que no monta su propio `run`: pestañas editables, sección, proveedor o
panel. La preparación común retira diálogos, menús, avisos, splits y docks heredados; la restauración
devuelve stores, borradores, acciones sustituidas, sección/subpestaña, foco, viewport y estado de main.
Libera los listeners de las pestañas ficticias. Las preparaciones internas autosuficientes se conservan.

Prueba el caso **solo** además de en la tanda. Las capturas pertenecen al caso antes de restaurar.
Un viewport inicial `null` en Playwright no significa que no haya tamaño: captura `innerWidth/Height`,
o un caso que lo agrande deja ese tamaño a los siguientes. Si falla ejecución y restauración, conserva
ambos errores; la limpieza no debe ocultar la causa inicial.

`sessionIdByChat` también contiene ids sintéticos (p. ej. `v39-session`): no demuestra que main tenga
una sesión viva. Al liberar recursos, solo «Sesion inexistente: <ese id>» es una ausencia idempotente;
cualquier otro error de stop/IPC se propaga. No convertir la limpieza en un catch general silencioso.

El diálogo «¿Cerrar Mage?» tiene una pregunta pendiente en main, además de `closePromptOpen`. La
preparación cancela por `answerClose` y espera al desmontaje; si llegó abierto, la restauración vuelve
a pedir el cierre para recuperar ambos lados. No esperar su desaparición sin cancelar: la captura
del bloqueo mostró cero animaciones y ese diálogo todavía abierto. `--inspect-running` lee el estado
de una tanda bloqueada; `--initial-close-prompt --only=2.7:` prueba esa entrada heredada.

### 9. Motion por JS y el panel saliente no aparecen como animaciones WAAPI

Reproducido con `--slow-frames` (cadencia de un segundo, inyectada **antes de importar Motion**):
preguntas de 189 px dentro de un contenedor que aún mide 43 px; subagentes de 80 px dentro de 8 px;
cola superpuesta al input y filas salientes todavía montadas. **Cero toasts y cero `getAnimations()`**.
No era el aviso anterior ni un bug de posición: se medía durante la animación de altura por JS.

En los docks, espera al estado terminal de la altura (`style.height === 'auto'`, opacidad 1) y al
composer quieto; después afirma la geometría con la tolerancia original. Para salida, espera
**detached**. `--trace-layout` guarda cajas, ancestros, animaciones, paneles y avisos en el informe.
`--slow-frames` es una inyección de fallo para regresiones, nunca una espera añadida al camino normal.

Al cambiar de panel, `AnimatePresence` mantiene un contenido saliente junto al entrante. El Inspector
concatenaba «Esta conversación todavía no ha creado ningún fichero» antes de Contexto y el recorte de
140 caracteres se comía «TOKENS»: espera a **un solo contenido**, opacidad 1, antes de leerlo.

Una transcripción ficticia tampoco termina de fallar en 800 ms: main sondea el fichero hasta 30 s.
Espera a que `lastParams.sessionId` y `transcriptId` identifiquen la lectura, **cancélala** y entonces
inyecta el fixture por pestaña. Así un lote tardío no pisa la medición ni contamina al siguiente caso.
