import { describe, expect, it } from 'vitest';
import { closeAnswerFromNative, interpretCloseAnswer, parseCloseAnswer, resolveCloseAction, type CloseContext } from './closePolicy';

function context(overrides: Partial<CloseContext> = {}): CloseContext {
  return { behavior: 'ask', isQuitting: false, isMainWindow: true, visibleWindowCount: 1, platform: 'win32', ...overrides };
}

describe('resolveCloseAction', () => {
  it('resolveCloseAction_ultimaVentanaSinDecisionGuardada_pregunta', () => {
    expect(resolveCloseAction(context())).toBe('ask');
  });

  it('resolveCloseAction_quitAndInstallDelAutoupdater_cierraSinPreguntar', () => {
    // `quitAndInstall` llama a `app.quit()`, que pasa por `before-quit` (isQuitting) y luego cierra cada
    // ventana: si el dialogo se interpusiera, la salida se cancelaria y la actualizacion no se instalaria.
    for (const behavior of ['ask', 'background', 'quit'] as const) {
      expect(resolveCloseAction(context({ behavior, isQuitting: true }))).toBe('close');
    }
  });

  it('resolveCloseAction_saliendoEnMacOS_cierra', () => {
    expect(resolveCloseAction(context({ isQuitting: true, platform: 'darwin' }))).toBe('close');
  });

  it('resolveCloseAction_ventanaSecundaria_cierraSinPreguntar', () => {
    expect(resolveCloseAction(context({ isMainWindow: false }))).toBe('close');
  });

  it('resolveCloseAction_quedanOtrasVentanasVisibles_cierra', () => {
    expect(resolveCloseAction(context({ visibleWindowCount: 2 }))).toBe('close');
  });

  it('resolveCloseAction_recordadoSegundoPlano_oculta', () => {
    expect(resolveCloseAction(context({ behavior: 'background' }))).toBe('hide');
  });

  it('resolveCloseAction_recordadoCerrar_sale', () => {
    expect(resolveCloseAction(context({ behavior: 'quit' }))).toBe('quit');
  });

  it('resolveCloseAction_macOS_ocultaSinPreguntar', () => {
    expect(resolveCloseAction(context({ platform: 'darwin' }))).toBe('hide');
    expect(resolveCloseAction(context({ platform: 'darwin', behavior: 'quit' }))).toBe('hide');
  });

  it('resolveCloseAction_ningunaVisible_pregunta', () => {
    // 0 no deberia darse (la que se cierra cuenta), pero no puede abrir la puerta a cerrar sin preguntar.
    expect(resolveCloseAction(context({ visibleWindowCount: 0 }))).toBe('ask');
  });
});

describe('interpretCloseAnswer', () => {
  it('interpretCloseAnswer_segundoPlanoSinRecordar_ocultaYNoGuarda', () => {
    expect(interpretCloseAnswer({ action: 'hide', remember: false })).toEqual({ action: 'hide', remember: null });
  });

  it('interpretCloseAnswer_segundoPlanoRecordado_guardaBackground', () => {
    expect(interpretCloseAnswer({ action: 'hide', remember: true })).toEqual({ action: 'hide', remember: 'background' });
  });

  it('interpretCloseAnswer_cerrarRecordado_guardaQuit', () => {
    expect(interpretCloseAnswer({ action: 'quit', remember: true })).toEqual({ action: 'quit', remember: 'quit' });
  });

  it('interpretCloseAnswer_cancelarConRecordar_noGuardaNada', () => {
    expect(interpretCloseAnswer({ action: 'cancel', remember: true })).toEqual({ action: 'cancel', remember: null });
  });
});

describe('closeAnswerFromNative', () => {
  it('closeAnswerFromNative_cadaBoton_suAccionEnElOrdenDeLosBotones', () => {
    expect(closeAnswerFromNative({ response: 0, checkboxChecked: true })).toEqual({ action: 'hide', remember: true });
    expect(closeAnswerFromNative({ response: 1, checkboxChecked: false })).toEqual({ action: 'quit', remember: false });
    expect(closeAnswerFromNative({ response: 2, checkboxChecked: true })).toEqual({ action: 'cancel', remember: true });
  });

  it('closeAnswerFromNative_respuestaDesconocida_cancela', () => {
    expect(closeAnswerFromNative({ response: -1, checkboxChecked: false }).action).toBe('cancel');
    expect(closeAnswerFromNative({ response: 7, checkboxChecked: false }).action).toBe('cancel');
  });
});

describe('parseCloseAnswer', () => {
  it('parseCloseAnswer_respuestaValida_laDevuelve', () => {
    expect(parseCloseAnswer({ action: 'quit', remember: true })).toEqual({ action: 'quit', remember: true });
  });

  it('parseCloseAnswer_accionDesconocida_lanzaConElValorRecibido', () => {
    expect(() => parseCloseAnswer({ action: 'destroy', remember: false })).toThrow(/destroy/);
  });

  it('parseCloseAnswer_camposDeMasOFaltan_lanza', () => {
    expect(() => parseCloseAnswer({ action: 'hide', remember: false, extra: 1 })).toThrow(/extra/);
    expect(() => parseCloseAnswer({ action: 'hide' })).toThrow(/hide/);
    expect(() => parseCloseAnswer(null)).toThrow(/null/);
  });
});
