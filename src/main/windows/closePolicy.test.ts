import { describe, expect, it } from 'vitest';
import { interpretCloseDialog, resolveCloseAction, type CloseContext } from './closePolicy';

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

describe('interpretCloseDialog', () => {
  it('interpretCloseDialog_segundoPlanoSinRecordar_ocultaYNoGuarda', () => {
    expect(interpretCloseDialog({ response: 0, checkboxChecked: false })).toEqual({ action: 'hide', remember: null });
  });

  it('interpretCloseDialog_segundoPlanoRecordado_guardaBackground', () => {
    expect(interpretCloseDialog({ response: 0, checkboxChecked: true })).toEqual({ action: 'hide', remember: 'background' });
  });

  it('interpretCloseDialog_cerrarRecordado_guardaQuit', () => {
    expect(interpretCloseDialog({ response: 1, checkboxChecked: true })).toEqual({ action: 'quit', remember: 'quit' });
  });

  it('interpretCloseDialog_cancelarConRecordar_noGuardaNada', () => {
    expect(interpretCloseDialog({ response: 2, checkboxChecked: true })).toEqual({ action: 'cancel', remember: null });
  });

  it('interpretCloseDialog_respuestaDesconocida_cancela', () => {
    expect(interpretCloseDialog({ response: -1, checkboxChecked: false }).action).toBe('cancel');
  });
});
