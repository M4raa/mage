import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests de logica de negocio en Node (parser, resolver, defaults, adapter). El alias @shared
// replica el del build para que los tests importen el contrato compartido.
export default defineConfig({
  // @testing son fixtures COMPARTIDAS entre tests (7.11). No entra en ningun bundle: nada de
  // produccion la importa, y por eso no esta en electron.vite.config.ts.
  resolve: { alias: { '@shared': resolve('src/shared'), '@testing': resolve('src/testing') } },
  test: {
    environment: 'node',
    // `.tsx` TAMBIEN (7.3). Hoy no hay ninguno, y ese es justo el problema: con el patron anterior
    // (`*.test.ts` a secas) el dia que alguien escriba `Foo.test.tsx` no se ejecutaria y NO fallaria
    // — simplemente no aparecería, que es la peor forma de perder una comprobacion.
    // Y los modulos PUROS de los scripts del repo (p. ej. la guarda de uso de `verify:gui`), que son .mjs
    // porque el harness corre en node sin el pipeline de TS.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // `threads` en vez del default `forks` (7.1). Medido sobre la suite completa: 4,99 s -> 4,14 s
    // sin tocar el aislamiento por fichero, que se mantiene. El coste de la suite NO esta en los tests
    // (2,7 s) sino en arrancar workers: `prepare` era 16,5 s de los 5 s de reloj de pared.
    //
    // `isolate: false`: ACTIVADO el 2026-09-16 (decision 7.2, cerrada en la auditoria B.6.3). Medido
    // aqui con la suite de 2.122 tests: 5,1 s -> 1,8 s, en verde con tres pasadas de --sequence.shuffle.
    //
    // La condicion que lo tuvo parado sigue viva y hay que respetarla: `proxy/gateway.ts` tiene cuatro
    // singletons de modulo (sessions, server, serverPort, gatewayLog) que sin aislamiento se COMPARTEN
    // entre los ficheros de test que importen ese modulo. Hoy son dos y el reparto es seguro:
    // `gateway.test.ts` solo usa sus funciones PURAS (convertAnthropicToOpenAi, isMessagesRequest) y
    // `gatewayHttp.test.ts` es el unico que arranca/para el servidor y registra sesiones, con su
    // beforeAll/afterAll. Un TERCER fichero que toque esos singletons tiene que hacer lo mismo (arrancar
    // y parar en sus propios hooks) o volver a poner `isolate: true` — un intermitente por estado
    // compartido cuesta mas que los 3 segundos que esto ahorra.
    isolate: false,
    pool: 'threads',
    coverage: {
      provider: 'v8',
      // Solo la logica de negocio: los entrypoints, los .tsx (que no se testean por diseño — la GUI se
      // verifica con `pnpm verify:gui`) y los propios tests no dicen nada util en un porcentaje.
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/renderer/src/workbench/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/main/index.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'html'],
      // Umbrales sobre las tres carpetas donde un fallo se traduce en dinero o en credenciales. Estan
      // puestos por DEBAJO de lo que hay hoy a proposito: son un suelo contra la erosion, no una meta.
      thresholds: {
        'src/main/engine/**': { statements: 70, branches: 65 },
        'src/main/accounts/**': { statements: 70, branches: 65 },
        'src/main/usage/**': { statements: 70, branches: 65 },
      },
    },
  },
});
