import { createReadStream, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { TranscriptBatch } from '@shared/transcripts';
import { TranscriptService, type TranscriptDeps, type TranscriptServiceOptions } from './transcriptService';

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(currentDir, 'fixtures', name);

// `delay` instantaneo: el sondeo de aparicion del fichero corre sin timers reales (tests rapidos).
// `sizeOf` real (statSync): las pruebas de reanudacion (I5) contra fixtures reales necesitan un
// tamano de verdad, no un valor fijo que pasaria por alto el guard de "posicion ya invalida".
function buildService(
  exists: (p: string) => boolean = () => true,
  options?: TranscriptServiceOptions,
  overrides: Partial<TranscriptDeps> = {},
): TranscriptService {
  return new TranscriptService(
    {
      exists,
      sizeOf: (p) => (exists(p) ? statSync(p).size : -1),
      createReadStream: (p, start) => createReadStream(p, { encoding: 'utf8', ...(start === undefined ? {} : { start }) }),
      delay: async () => {},
      ...overrides,
    },
    options,
  );
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

describe('TranscriptService.openStream', () => {
  it('rutaVacia_lanza', async () => {
    const service = buildService();
    const controller = new AbortController();

    await expect(collect(service.openStream('', controller.signal))).rejects.toThrow('Ruta de transcripcion invalida');
  });

  it('archivoNoExisteTrasAgotarLaEspera_lanzaConLaRutaEnElMensaje', async () => {
    const service = buildService(() => false, { maxWaitMs: 0 }); // sin ventana de espera: 1 sondeo
    const controller = new AbortController();

    await expect(collect(service.openStream('C:\\no\\existe.jsonl', controller.signal))).rejects.toThrow(
      'C:\\no\\existe.jsonl',
    );
  });

  it('archivoApareceTrasVariosSondeos_esperaYLuegoEntregaLotes', async () => {
    // Simula la carrera real: el .jsonl no existe al abrir y aparece unos sondeos despues (el CLI lo
    // vuelca al arrancar el primer turno). openStream debe ESPERAR y acabar leyendolo, no lanzar.
    let calls = 0;
    const path = fixture('mixed-types.jsonl');
    const service = buildService((p) => (p === path ? ++calls >= 3 : true), { pollIntervalMs: 1, maxWaitMs: 100 });
    const controller = new AbortController();

    const batches = await collect(service.openStream(path, controller.signal));

    expect(calls).toBeGreaterThanOrEqual(3); // esperó a que apareciera
    expect(batches.flatMap((b) => b.entries)).toHaveLength(13);
    expect(batches.at(-1)?.isFinal).toBe(true);
  });

  it('signalAbortadaMientrasEsperaElFichero_noLanzaNiEntregaLotes', async () => {
    // Aborta durante la espera (fichero que nunca aparece): no debe lanzar el error de inexistencia.
    const controller = new AbortController();
    const service = new TranscriptService(
      {
        exists: () => false,
        sizeOf: () => -1,
        createReadStream: () => Readable.from([]) as any,
        // Aborta en el primer delay: emula el cierre de pestana mientras se esperaba al fichero.
        delay: async () => controller.abort(),
      },
      { pollIntervalMs: 1, maxWaitMs: 100 },
    );

    const batches = await collect(service.openStream('C:\\aun\\no.jsonl', controller.signal));

    expect(batches).toHaveLength(0);
  });

  it('archivoValido_entregaLotesConTodasLasEntradas', async () => {
    const service = buildService();
    const controller = new AbortController();

    const batches = await collect(service.openStream(fixture('mixed-types.jsonl'), controller.signal));

    const entries = batches.flatMap((b) => b.entries);
    expect(entries).toHaveLength(13);
    expect(batches.at(-1)?.isFinal).toBe(true);
  });

  it('signalAbortadaAntesDeEmpezar_noEntregaNingunLote', async () => {
    const service = buildService();
    const controller = new AbortController();
    controller.abort();

    const batches = await collect(service.openStream(fixture('mixed-types.jsonl'), controller.signal));

    expect(batches).toHaveLength(0);
  });

  it('signalAbortadaAMitadDeLectura_detieneSinLanzar', async () => {
    // Stream controlado manualmente (push explicito, sin logica dentro de read()): permite abortar
    // mientras el productor sigue activo, sin depender de reentrancia en el callback de lectura.
    const stream = new Readable({ read() {} });
    const controller = new AbortController();
    const service = new TranscriptService({ exists: () => true, sizeOf: () => 0, createReadStream: () => stream as any });

    const results: TranscriptBatch[] = [];
    const consuming = (async () => {
      for await (const batch of service.openStream('cualquier-ruta.jsonl', controller.signal)) results.push(batch);
    })();

    stream.push('{"type":"mode","mode":"normal"}\n');
    // NO se espera a nada (antes habia un sleep de 20 ms "para que flusheara el primer lote"): el
    // reader NO tiene temporizador de fondo — `dueByTime` solo se evalua DENTRO del bucle de lineas,
    // asi que con una sola linea empujada nunca sale un lote. Aquel comentario describia un
    // mecanismo que no existe, y la asercion final operaba sobre un array vacio: verdadera por
    controller.abort();
    stream.push(null); // el productor original seguia "activo"; el abort debe cortar igualmente
    await consuming;

    // Se detiene en cuanto detecta el abort; no debe llegar el lote final (isFinal:true).
    // vacuidad. Se afirma explicitamente lo que de verdad ocurre.
    expect(results).toHaveLength(0);
  });
});

// I5: lectura incremental (tail). Fichero en memoria (string mutable) en vez de fixtures en disco —
// deja simular "el CLI anadio lineas nuevas entre dos refrescos" sin FS real ni temporales.
function fakeFileDeps(getContent: () => string): TranscriptDeps {
  return {
    exists: () => true,
    sizeOf: () => Buffer.byteLength(getContent()),
    createReadStream: (_path, start) => Readable.from([getContent().slice(start ?? 0)]) as unknown as NodeJS.ReadableStream,
  };
}

describe('TranscriptService.openStream — reanudacion (I5)', () => {
  it('sinResumeFrom_leeDesdeElPrincipioComoSiempre', async () => {
    const service = new TranscriptService(fakeFileDeps(() => '{"type":"mode","mode":"normal"}\n'));
    const controller = new AbortController();

    const batches = await collect(service.openStream('f.jsonl', controller.signal));

    expect(batches.flatMap((b) => b.entries)).toHaveLength(1);
    expect(batches.at(-1)?.totalLinesSoFar).toBe(1);
  });

  it('conResumeFromAlFinalDelFichero_noRepiteNadaYaLeido', async () => {
    const content = '{"type":"mode","mode":"normal"}\n{"type":"user","message":{"content":"hola"}}\n';
    const service = new TranscriptService(fakeFileDeps(() => content));
    const controller = new AbortController();

    const first = await collect(service.openStream('f.jsonl', controller.signal));
    const endPos = first.at(-1)!;

    const second = await collect(
      service.openStream('f.jsonl', controller.signal, {
        bytesRead: endPos.bytesReadSoFar,
        rawLineNumber: endPos.rawLineNumber,
        totalLinesSoFar: endPos.totalLinesSoFar,
      }),
    );

    expect(second.flatMap((b) => b.entries)).toHaveLength(0); // nada nuevo: el fichero no cambio
    expect(second.at(-1)?.totalLinesSoFar).toBe(2); // el recuento sigue reflejando las 2 de siempre
  });

  it('conResumeFromYNuevasLineasAnadidas_soloEntregaLasNuevas_conIndexQueContinua', async () => {
    let content = '{"type":"mode","mode":"normal"}\n';
    const service = new TranscriptService(fakeFileDeps(() => content));
    const controller = new AbortController();

    const first = await collect(service.openStream('f.jsonl', controller.signal));
    const afterFirst = first.at(-1)!;
    content += '{"type":"user","message":{"content":"hola"}}\n{"type":"user","message":{"content":"adios"}}\n';

    const second = await collect(
      service.openStream('f.jsonl', controller.signal, {
        bytesRead: afterFirst.bytesReadSoFar,
        rawLineNumber: afterFirst.rawLineNumber,
        totalLinesSoFar: afterFirst.totalLinesSoFar,
      }),
    );
    const newEntries = second.flatMap((b) => b.entries);

    expect(newEntries).toHaveLength(2); // solo las 2 NUEVAS, no las 3 del fichero completo
    expect(newEntries.map((e) => e.index)).toEqual([1, 2]); // continua tras la linea 0 ya leida, sin colisionar
    expect(second.at(-1)?.totalLinesSoFar).toBe(3); // 1 previa + 2 nuevas
  });

  it('resumeFromConFicheroMasPequenoQueLaPosicionRecordada_releeDesdeElPrincipio', async () => {
    // El fichero se "acorto" (nunca deberia pasar con el CLI real, pero no se asume): la posicion
    // recordada de un fichero mas grande ya no vale, y hay que releer entero en vez de pedir un rango
    // fuera de los limites del fichero actual.
    const content = '{"type":"mode","mode":"normal"}\n';
    const service = new TranscriptService(fakeFileDeps(() => content));
    const controller = new AbortController();

    const batches = await collect(
      service.openStream('f.jsonl', controller.signal, { bytesRead: 999_999, rawLineNumber: 500, totalLinesSoFar: 500 }),
    );

    expect(batches.flatMap((b) => b.entries)).toHaveLength(1); // relee la unica linea real que hay
    expect(batches.at(-1)?.totalLinesSoFar).toBe(1); // recuento desde 0, no desde 500
  });
});
