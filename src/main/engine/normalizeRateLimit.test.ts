import { describe, expect, it } from 'vitest';
import { normalizeRawEvent } from './normalize';

// Los DOS caminos de rate limit no tenian ni un test: la palabra no aparecia una sola vez en los 44
// de `normalize.test.ts`. Y no es un caso hipotetico — agotar la bolsa de uso es lo que le pasa a
// cualquiera que use Mage a diario. Si esto se rompe, el usuario ve un turno que se corta sin decir
// por que, que es el peor de los fallos posibles aqui.
//
// Van en fichero aparte a proposito: `normalize.test.ts` son 560 lineas en UN solo describe sin
// estructura interna (el peor del repo), y meter aqui dentro habria sido empeorarlo.

describe('normalizeRawEvent — rate limit por `assistant` con error', () => {
  // Este camino SI esta medido contra una transcripcion real: el CLI lo manda como un `assistant`
  // marcado con error:"rate_limit" y apiErrorStatus:429, con el texto ya redactado dentro.
  const evento = (content: unknown): Record<string, unknown> => ({ type: 'assistant', error: 'rate_limit', apiErrorStatus: 429, message: { content } });

  it('normalizeRawEvent_assistantConErrorRateLimit_emiteEventoRateLimitYNoTextoDeAsistente', () => {
    const events = normalizeRawEvent(evento([{ type: 'text', text: 'Has alcanzado el limite de uso.' }]));

    expect(events).toEqual([{ kind: 'rate_limit', summary: 'Has alcanzado el limite de uso.', resetsAtMs: null }]);
  });

  it('normalizeRawEvent_assistantConErrorRateLimit_noSeCuelaComoAssistantText', () => {
    // Lo que importa de verdad: NO es texto del asistente. Si se colara como `assistant_text`, el
    // aviso se pintaria como si el modelo lo hubiera dicho, dentro de la burbuja de la respuesta.
    const events = normalizeRawEvent(evento([{ type: 'text', text: 'limite' }]));

    expect(events.some((e) => e.kind === 'assistant_text')).toBe(false);
  });

  it('normalizeRawEvent_rateLimitSinTexto_emiteResumenVacioPeroSiElEvento', () => {
    // Sin texto sigue habiendo limite: el evento tiene que salir igual, aunque el resumen quede vacio.
    const events = normalizeRawEvent(evento([]));

    expect(events).toEqual([{ kind: 'rate_limit', summary: '', resetsAtMs: null }]);
  });
});

describe('normalizeRawEvent — rate limit por `rate_limit_event`', () => {
  // Este otro camino lo vio la sonda en el stream EN VIVO, pero sus campos NO estan medidos (provocar
  // un rate limit de verdad significa agotar la suscripcion). De ahi que se lea a la defensiva: se
  // aceptan solo textos que vengan como string en las claves mas obvias, y cualquier otra forma NO
  // produce evento en vez de producir uno vacio o inventado. Estos tests fijan ese contrato.
  const evento = (extra: Record<string, unknown>): Record<string, unknown> => ({ type: 'rate_limit_event', ...extra });

  it('normalizeRawEvent_rateLimitEventConMessage_usaEseTexto', () => {
    expect(normalizeRawEvent(evento({ message: 'Limite alcanzado' }))).toEqual([
      { kind: 'rate_limit', summary: 'Limite alcanzado', resetsAtMs: null },
    ]);
  });

  it('normalizeRawEvent_rateLimitEventConText_usaEseTexto', () => {
    expect(normalizeRawEvent(evento({ text: 'Espera un rato' }))[0]).toMatchObject({ kind: 'rate_limit', summary: 'Espera un rato' });
  });

  it('normalizeRawEvent_rateLimitEventConSummary_usaEseTexto', () => {
    expect(normalizeRawEvent(evento({ summary: 'Sin cuota' }))[0]).toMatchObject({ kind: 'rate_limit', summary: 'Sin cuota' });
  });

  it('normalizeRawEvent_rateLimitEventAnidado_leeRateLimitMessage', () => {
    expect(normalizeRawEvent(evento({ rate_limit: { message: 'Anidado' } }))[0]).toMatchObject({ summary: 'Anidado' });
  });

  it('normalizeRawEvent_rateLimitEventPrefiereMessageSobreElResto', () => {
    const events = normalizeRawEvent(evento({ message: 'primero', text: 'segundo', summary: 'tercero' }));

    expect(events[0]).toMatchObject({ summary: 'primero' });
  });

  it('normalizeRawEvent_rateLimitEventSinNingunTexto_noEmiteNada', () => {
    // Preferible callarse a inventar un aviso vacio: el usuario no gana nada con "" y el hilo se
    // ensucia con una linea de sistema sin contenido.
    expect(normalizeRawEvent(evento({}))).toEqual([]);
  });

  it('normalizeRawEvent_rateLimitEventConTextoNoString_noEmiteNada', () => {
    expect(normalizeRawEvent(evento({ message: 42 }))).toEqual([]);
    expect(normalizeRawEvent(evento({ message: { anidado: 'x' } }))).toEqual([]);
  });

  it('normalizeRawEvent_rateLimitEventConTextoEnBlanco_noEmiteNada', () => {
    expect(normalizeRawEvent(evento({ message: '   ' }))).toEqual([]);
  });
});

// Payload REAL capturado el 2026-09-14 contra el CLI 2.1.270 (`spike/engine-spike.mjs`). Se deja
// entero, tal cual llego, para que estos tests fallen si el CLI cambia la forma: es la unica manera de
// enterarse sin volver a gastar un turno.
const PAYLOAD_MEDIDO = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1789384200,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    overageResetsAt: 1790812800,
    overageDisabledReason: 'org_level_disabled_until',
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.36, resetsAt: 1789384200 },
      seven_day: { utilization: 0.49, resetsAt: 1789531200 },
    },
  },
};

describe('normalizeRawEvent - rate_limit_event medido (Fase 9, S3)', () => {
  const evento = (extra: Record<string, unknown>): Record<string, unknown> => ({ type: 'rate_limit_event', ...extra });

  it('rateLimitEvent_payloadMedido_emiteUsageLimitsYNoAvisoDeLimite', () => {
    const events = normalizeRawEvent(PAYLOAD_MEDIDO);

    // Un turno normal NO puede encender el banner de "limite alcanzado".
    expect(events).toEqual([
      {
        kind: 'usage_limits',
        fiveHour: { utilization: 36, resetsAt: 1789384200_000 },
        sevenDay: { utilization: 49, resetsAt: 1789531200_000 },
      },
    ]);
  });

  it('rateLimitEvent_utilizationEsFraccion_seConvierteAPorcentajeComoElEndpoint', () => {
    // 0,36 en el stream = 36 % en el endpoint, medido en el mismo instante. Sin convertir, 0 %.
    const events = normalizeRawEvent(evento({ rate_limit_info: { unifiedWindows: { five_hour: { utilization: 1 } } } }));

    expect(events[0]).toMatchObject({ kind: 'usage_limits', fiveHour: { utilization: 100, resetsAt: null } });
  });

  it('rateLimitEvent_utilizationFueraDeCeroAUno_descartaLaVentanaEnVezDeInventarla', () => {
    const events = normalizeRawEvent(evento({ rate_limit_info: { unifiedWindows: { five_hour: { utilization: 36 } } } }));

    expect(events).toEqual([]); // 36 no es una fraccion: no se emite un 3600 % ni un 100 % fingido
  });

  it('rateLimitEvent_utilizationSoloEnLaRaiz_noSeLee', () => {
    // La spec del fuente lo ponia en la raiz; el binario real NO. Leerlo de ahi daria undefined siempre.
    expect(normalizeRawEvent(evento({ rate_limit_info: { utilization: 0.5 } }))).toEqual([]);
  });

  it('rateLimitEvent_statusRejected_emiteAvisoConResetsAtEnMilisegundos', () => {
    const events = normalizeRawEvent(evento({ rate_limit_info: { status: 'rejected', resetsAt: 1789384200 } }));

    expect(events).toEqual([{ kind: 'rate_limit', summary: '', resetsAtMs: 1789384200_000 }]);
  });

  it('rateLimitEvent_statusRejectedConVentanas_emiteLasDosCosas', () => {
    const events = normalizeRawEvent(
      evento({
        rate_limit_info: { status: 'rejected', resetsAt: 1789384200, unifiedWindows: { five_hour: { utilization: 1 } } },
      }),
    );

    expect(events.map((e) => e.kind)).toEqual(['usage_limits', 'rate_limit']);
  });

  it('rateLimitEvent_sinRateLimitInfo_noEmiteNada', () => {
    expect(normalizeRawEvent(evento({}))).toEqual([]);
  });
});
