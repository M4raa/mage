// Que hacer cuando el usuario cierra una ventana del workbench (P-028, punto 17). Puro: la decision no
// toca Electron, la ejecuta `index.ts`. Asi se prueba lo que no se puede romper —que la salida de la
// app, la del autoupdater incluida, nunca se quede bloqueada por el dialogo— sin arrancar nada.

import { z } from 'zod';
import type { CloseAnswer } from '@shared/ipc';
import type { CloseBehavior } from '@shared/settings';

//   'close' — dejar que la ventana se destruya (y con ella sus sesiones).
//   'hide'  — mandarla a segundo plano: se oculta, su renderer y sus agentes siguen vivos.
//   'quit'  — salir de Mage.
//   'ask'   — preguntar: con el dialogo propio del renderer, o el nativo si el renderer no puede pintarlo.
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

// Botones del dialogo NATIVO (la reserva cuando el renderer esta caido o cargando), en este orden. El
// indice de cada uno es lo que devuelve `showMessageBox`.
export const CLOSE_DIALOG_BUTTONS = ['Mantener en segundo plano', 'Cerrar Mage', 'Cancelar'] as const;
export const CLOSE_DIALOG_CANCEL_INDEX = 2;

export interface NativeCloseDialogAnswer {
  readonly response: number;
  readonly checkboxChecked: boolean;
}

export interface CloseDialogOutcome {
  readonly action: 'hide' | 'quit' | 'cancel';
  // Lo que se guarda si el usuario marco «Recordar mi decisión»; null = no se guarda nada.
  readonly remember: Exclude<CloseBehavior, 'ask'> | null;
}

// La respuesta del dialogo propio llega del renderer: frontera, se valida entera.
const CLOSE_ANSWER_SCHEMA = z.object({ action: z.enum(['hide', 'quit', 'cancel']), remember: z.boolean() }).strict();

export function parseCloseAnswer(value: unknown): CloseAnswer {
  const result = CLOSE_ANSWER_SCHEMA.safeParse(value);
  if (!result.success) throw new Error(`Respuesta de cierre no valida: ${JSON.stringify(value)}`);
  return result.data;
}

// El boton del dialogo nativo, en la misma forma que la respuesta del propio. Un indice desconocido
// (cerrarlo con Esc da `cancelId`, pero por si acaso) es cancelar.
const NATIVE_BUTTON_ACTIONS: readonly CloseAnswer['action'][] = ['hide', 'quit', 'cancel'];

export function closeAnswerFromNative(answer: NativeCloseDialogAnswer): CloseAnswer {
  return { action: NATIVE_BUTTON_ACTIONS[answer.response] ?? 'cancel', remember: answer.checkboxChecked };
}

// Traduce la respuesta del dialogo. «Cancelar» (o cerrarlo con Esc) nunca se recuerda: recordar
// "no cerrar" dejaria la X sin efecto para siempre.
export function interpretCloseAnswer(answer: CloseAnswer): CloseDialogOutcome {
  if (answer.action === 'hide') return { action: 'hide', remember: answer.remember ? 'background' : null };
  if (answer.action === 'quit') return { action: 'quit', remember: answer.remember ? 'quit' : null };
  return { action: 'cancel', remember: null };
}
