// Que hacer cuando el usuario cierra una ventana del workbench (P-028, punto 17). Puro: la decision no
// toca Electron, la ejecuta `index.ts`. Asi se prueba lo que no se puede romper —que la salida de la
// app, la del autoupdater incluida, nunca se quede bloqueada por el dialogo— sin arrancar nada.

import type { CloseBehavior } from '@shared/settings';

//   'close' — dejar que la ventana se destruya (y con ella sus sesiones).
//   'hide'  — mandarla a segundo plano: se oculta, su renderer y sus agentes siguen vivos.
//   'quit'  — salir de Mage.
//   'ask'   — preguntar con el dialogo nativo.
export type CloseAction = 'close' | 'hide' | 'quit' | 'ask';

export interface CloseContext {
  readonly behavior: CloseBehavior;
  // La app ya esta saliendo (`before-quit`: «Salir» de la bandeja, Cmd+Q o `quitAndInstall`).
  readonly isQuitting: boolean;
  // Solo la ventana PRINCIPAL pregunta: una secundaria se cierra sin mas y para sus sesiones.
  readonly isMainWindow: boolean;
  // Ventanas del workbench visibles, esta incluida.
  readonly visibleWindowCount: number;
  readonly platform: NodeJS.Platform;
}

export function resolveCloseAction(context: CloseContext): CloseAction {
  // Primero la salida: `app.quit()` cierra todas las ventanas y basta con que una impida su `close`
  // para cancelar la salida entera. Es lo que dejaria a medias la instalacion de una actualizacion.
  if (context.isQuitting) return 'close';
  if (!context.isMainWindow) return 'close';
  // Quedan otras ventanas a la vista: cerrar esta no deja Mage sin ventana.
  if (context.visibleWindowCount > 1) return 'close';
  // macOS: el boton rojo oculta sin preguntar y Cmd+Q sale (que ya llega como `isQuitting`).
  if (context.platform === 'darwin') return 'hide';
  if (context.behavior === 'background') return 'hide';
  if (context.behavior === 'quit') return 'quit';
  return 'ask';
}

// Botones del dialogo, en este orden. El indice de cada uno es lo que devuelve `showMessageBox`.
export const CLOSE_DIALOG_BUTTONS = ['Mantener en segundo plano', 'Cerrar Mage', 'Cancelar'] as const;
export const CLOSE_DIALOG_CANCEL_INDEX = 2;

export interface CloseDialogAnswer {
  readonly response: number;
  readonly checkboxChecked: boolean;
}

export interface CloseDialogOutcome {
  readonly action: 'hide' | 'quit' | 'cancel';
  // Lo que se guarda si el usuario marco «Recordar mi decisión»; null = no se guarda nada.
  readonly remember: Exclude<CloseBehavior, 'ask'> | null;
}

// Traduce la respuesta del dialogo. «Cancelar» (o cerrarlo con Esc) nunca se recuerda: recordar
// "no cerrar" dejaria la X sin efecto para siempre.
export function interpretCloseDialog(answer: CloseDialogAnswer): CloseDialogOutcome {
  if (answer.response === 0) return { action: 'hide', remember: answer.checkboxChecked ? 'background' : null };
  if (answer.response === 1) return { action: 'quit', remember: answer.checkboxChecked ? 'quit' : null };
  return { action: 'cancel', remember: null };
}
