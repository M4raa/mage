import { describe, expect, it } from 'vitest';
import { IDLE_UPDATE_STATE, type UpdateState } from '@shared/update';
import {
  assertInstallable,
  decideCheck,
  describeEvent,
  MIN_CHECK_INTERVAL_MS,
  nextUpdateState,
  normalizeReleaseNotes,
  summarizeUpdaterMessage,
} from './updatePolicy';

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
  it('describeEvent_comprobando_info', () => {
    expect(describeEvent({ kind: 'checking' }).level).toBe('info');
  });

  it('describeEvent_actualizacionDisponible_infoConLaVersion', () => {
    expect(describeEvent({ kind: 'available', version: '0.2.0' }).message).toContain('0.2.0');
  });

  it('describeEvent_descargada_infoConLaVersion', () => {
    const notice = describeEvent({ kind: 'downloaded', version: '0.2.0', releaseNotes: null });

    expect(notice.level).toBe('info');
    expect(notice.message).toContain('0.2.0');
  });

  // Un fallo del updater no rompe nada de lo que el usuario esta haciendo: 'warn', nunca 'error'.
  it('describeEvent_error_avisaEnWarn', () => {
    const notice = describeEvent({ kind: 'error', message: 'ENOTFOUND github.com' });

    expect(notice.level).toBe('warn');
    expect(notice.message).toContain('ENOTFOUND github.com');
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

const READY: UpdateState = { kind: 'ready', version: '0.1.3', releaseNotes: '### Añadido' };

describe('nextUpdateState', () => {
  it('nextUpdateState_disponibleDesdeIdle_pasaADescargando', () => {
    expect(nextUpdateState(IDLE_UPDATE_STATE, { kind: 'available', version: '0.1.3' })).toEqual({ kind: 'downloading', version: '0.1.3' });
  });

  it('nextUpdateState_descargada_pasaAReadyConSusNotas', () => {
    const state = nextUpdateState({ kind: 'downloading', version: '0.1.3' }, { kind: 'downloaded', version: '0.1.3', releaseNotes: '### Añadido' });

    expect(state).toEqual(READY);
  });

  it('nextUpdateState_errorDuranteDescarga_vuelveAIdle', () => {
    expect(nextUpdateState({ kind: 'downloading', version: '0.1.3' }, { kind: 'error', message: 'ECONNRESET' })).toEqual(IDLE_UPDATE_STATE);
  });

  // Mage es residente: 6 h despues vuelve a comprobar. Ni un error de red, ni «al dia», ni volver a
  // ver la misma version pueden esconder lo que ya esta descargado.
  it('nextUpdateState_lista_seQuedaListaAnteComprobacionesPosteriores', () => {
    expect(nextUpdateState(READY, { kind: 'checking' })).toBe(READY);
    expect(nextUpdateState(READY, { kind: 'error', message: 'ENOTFOUND' })).toBe(READY);
    expect(nextUpdateState(READY, { kind: 'notAvailable', version: '0.1.3' })).toBe(READY);
    expect(nextUpdateState(READY, { kind: 'available', version: '0.1.3' })).toBe(READY);
  });

  it('nextUpdateState_listaYLlegaOtraVersion_descargaLaNueva', () => {
    expect(nextUpdateState(READY, { kind: 'available', version: '0.1.4' })).toEqual({ kind: 'downloading', version: '0.1.4' });
  });

  it('nextUpdateState_alDiaDesdeIdle_sigueIdle', () => {
    expect(nextUpdateState(IDLE_UPDATE_STATE, { kind: 'notAvailable', version: '0.1.2' })).toEqual(IDLE_UPDATE_STATE);
  });

  it('nextUpdateState_errorEnReposo_noCambiaNada', () => {
    expect(nextUpdateState(IDLE_UPDATE_STATE, { kind: 'error', message: 'ENOTFOUND' })).toBe(IDLE_UPDATE_STATE);
  });

  it('nextUpdateState_versionVacia_lanzaConElEvento', () => {
    expect(() => nextUpdateState(IDLE_UPDATE_STATE, { kind: 'downloaded', version: '', releaseNotes: null })).toThrow(/downloaded/);
    expect(() => nextUpdateState(IDLE_UPDATE_STATE, { kind: 'available', version: '' })).toThrow(/available/);
  });
});

describe('normalizeReleaseNotes', () => {
  it('normalizeReleaseNotes_markdownDelYml_loDevuelveRecortado', () => {
    expect(normalizeReleaseNotes('\n### Añadido\n- Algo\n')).toBe('### Añadido\n- Algo');
  });

  // Sin notas en el yml, electron-updater cae al HTML del feed de GitHub: no se pinta.
  it('normalizeReleaseNotes_htmlDelFeed_null', () => {
    expect(normalizeReleaseNotes('<h3>Añadido</h3><ul><li>Algo</li></ul>')).toBeNull();
  });

  it('normalizeReleaseNotes_vacioNullOLista_null', () => {
    expect(normalizeReleaseNotes('   ')).toBeNull();
    expect(normalizeReleaseNotes(null)).toBeNull();
    expect(normalizeReleaseNotes(undefined)).toBeNull();
    expect(normalizeReleaseNotes([{ version: '0.1.3', note: 'x' }])).toBeNull();
  });
});

describe('assertInstallable', () => {
  it('assertInstallable_lista_noLanza', () => {
    expect(() => assertInstallable(READY)).not.toThrow();
  });

  it('assertInstallable_sinActualizacionLista_lanzaConElEstado', () => {
    expect(() => assertInstallable(IDLE_UPDATE_STATE)).toThrow(/idle/);
    expect(() => assertInstallable({ kind: 'downloading', version: '0.1.3' })).toThrow(/downloading/);
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
