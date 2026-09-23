import { describe, expect, it } from 'vitest';
import { decideCheck, describeEvent, MIN_CHECK_INTERVAL_MS, summarizeUpdaterMessage } from './updatePolicy';

// Contexto base valido; cada test cambia solo lo que mide (AAA sin ruido).
const baseContext = {
  isPackaged: true,
  checkInFlight: false,
  lastCheckAtMs: null,
  nowMs: 1_000_000,
} as const;

describe('decideCheck', () => {
  it('decideCheck_appEmpaquetadaYSinComprobacionPrevia_compruebaAhora', () => {
    const decision = decideCheck(baseContext);

    expect(decision).toEqual({ check: true });
  });

  it('decideCheck_appNoEmpaquetada_noCompruebaYDiceElMotivo', () => {
    const decision = decideCheck({ ...baseContext, isPackaged: false });

    expect(decision.check).toBe(false);
    expect(decision.check === false && decision.reason).toContain('empaquetada');
  });

  it('decideCheck_comprobacionEnVuelo_noCompruebaAunqueEsteEmpaquetada', () => {
    const decision = decideCheck({ ...baseContext, checkInFlight: true });

    expect(decision.check).toBe(false);
    expect(decision.check === false && decision.reason).toContain('en vuelo');
  });

  it('decideCheck_dentroDelIntervaloMinimo_noComprueba', () => {
    const decision = decideCheck({ ...baseContext, lastCheckAtMs: baseContext.nowMs - (MIN_CHECK_INTERVAL_MS - 1) });

    expect(decision.check).toBe(false);
  });

  it('decideCheck_justoEnElIntervaloMinimo_comprueba', () => {
    const decision = decideCheck({ ...baseContext, lastCheckAtMs: baseContext.nowMs - MIN_CHECK_INTERVAL_MS });

    expect(decision).toEqual({ check: true });
  });

  // El reloj del sistema puede ir hacia atras (ajuste de hora, suspension): un elapsed negativo es
  // "hace menos del minimo", nunca una comprobacion en bucle.
  it('decideCheck_relojHaciaAtras_noComprueba', () => {
    const decision = decideCheck({ ...baseContext, lastCheckAtMs: baseContext.nowMs + 60_000 });

    expect(decision.check).toBe(false);
  });

  it('decideCheck_intervaloCero_compruebaSiempre', () => {
    const decision = decideCheck({ ...baseContext, lastCheckAtMs: baseContext.nowMs, minIntervalMs: 0 });

    expect(decision).toEqual({ check: true });
  });

  it('decideCheck_relojInvalido_lanzaConElValorRecibido', () => {
    expect(() => decideCheck({ ...baseContext, nowMs: Number.NaN })).toThrow(/NaN/);
  });

  it('decideCheck_intervaloNegativo_lanzaConElValorRecibido', () => {
    expect(() => decideCheck({ ...baseContext, minIntervalMs: -1 })).toThrow(/-1/);
  });
});

describe('describeEvent', () => {
  it('describeEvent_comprobando_infoSinAvisoAlUsuario', () => {
    const notice = describeEvent({ kind: 'checking' });

    expect(notice.level).toBe('info');
    expect(notice.prompt).toBeNull();
  });

  it('describeEvent_actualizacionDisponible_infoConLaVersionYSinAviso', () => {
    const notice = describeEvent({ kind: 'available', version: '0.2.0' });

    expect(notice.message).toContain('0.2.0');
    expect(notice.prompt).toBeNull();
  });

  it('describeEvent_sinActualizacion_infoSinAviso', () => {
    const notice = describeEvent({ kind: 'notAvailable', version: '0.1.0' });

    expect(notice.level).toBe('info');
    expect(notice.prompt).toBeNull();
  });

  it('describeEvent_descargada_ofreceReiniciarConDosBotones', () => {
    const notice = describeEvent({ kind: 'downloaded', version: '0.2.0' });

    expect(notice.prompt).not.toBeNull();
    expect(notice.prompt?.message).toContain('0.2.0');
    expect(notice.prompt?.buttons).toHaveLength(2);
    // El boton que reinicia y el de "mas tarde" NO pueden ser el mismo indice.
    expect(notice.prompt?.restartIndex).not.toBe(notice.prompt?.cancelIndex);
  });

  // Un fallo del updater no rompe nada de lo que el usuario esta haciendo: 'warn', nunca 'error'
  // (y nunca aviso modal).
  it('describeEvent_error_avisaEnWarnYNoMolestaAlUsuario', () => {
    const notice = describeEvent({ kind: 'error', message: 'ENOTFOUND github.com' });

    expect(notice.level).toBe('warn');
    expect(notice.message).toContain('ENOTFOUND github.com');
    expect(notice.prompt).toBeNull();
  });

  it('describeEvent_descargadaSinVersion_lanza', () => {
    expect(() => describeEvent({ kind: 'downloaded', version: '' })).toThrow(/[Vv]ersion/);
  });

  // Regresion del 404 real de GitHub medido en la app empaquetada: el mensaje traia pegada la
  // respuesta HTTP completa, con Set-Cookie incluido. Nada de eso puede acabar en el log.
  it('describeEvent_errorConLaRespuestaHttpPegada_soloDejaLaPrimeraLinea', () => {
    const raw = '404 \n"method: GET url: https://github.com/M4raa/mage_porter/releases.atom"\nHeaders: {\n "set-cookie": ["_gh_sess=SECRETO"]\n}';

    const notice = describeEvent({ kind: 'error', message: raw });

    expect(notice.message).toContain('404');
    expect(notice.message).not.toContain('SECRETO');
    expect(notice.message).not.toContain('\n');
  });
});

describe('summarizeUpdaterMessage', () => {
  it('summarizeUpdaterMessage_mensajeCorto_loDevuelveTalCual', () => {
    expect(summarizeUpdaterMessage('Checking for update')).toBe('Checking for update');
  });

  it('summarizeUpdaterMessage_variasLineas_soloLaPrimera', () => {
    expect(summarizeUpdaterMessage('HttpError: 404\nHeaders: {...}')).toBe('HttpError: 404');
  });

  it('summarizeUpdaterMessage_lineaLarguisima_recortaConElipsis', () => {
    const summary = summarizeUpdaterMessage('x'.repeat(500));

    expect(summary).toHaveLength(201); // 200 + la elipsis
    expect(summary.endsWith('…')).toBe(true);
  });

  it('summarizeUpdaterMessage_vacio_diceQueNoHabiaMensaje', () => {
    expect(summarizeUpdaterMessage('')).toBe('error sin mensaje');
    expect(summarizeUpdaterMessage('\n  \n')).toBe('error sin mensaje');
  });
});
