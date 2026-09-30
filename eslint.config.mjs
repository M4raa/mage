import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// ESLint MINIMO, y a proposito (auditoria B.6.1). No es un linter de estilo: el proyecto ya tiene
// typecheck + 2.100 tests + `pnpm verify:gui`, y una configuracion "recomendada" completa solo añadiria
// ruido sobre 60 k lineas ya escritas.
//
// Lo que si hace falta son las dos reglas de los hooks de React, porque son las UNICAS que ninguna de
// esas tres puertas puede ver: el typecheck no sabe que un hook no puede ir detras de un `return`, y un
// test unitario tampoco. De ahi salieron dos bugs reales de la parte A de la auditoria — un hook tras
// un `return null` en `dock/Stripe.tsx` (React lanzaba "Rendered fewer hooks than expected" y el arbol
// se iba al ErrorBoundary) y un `useEffect([])` con dependencias mentidas en `BlockChat.tsx` (el chat
// te devolvia al fondo en cada delta, imposible subir a leer).
//
// El parser de TypeScript va SIN informacion de tipos (`projectService`/`project` no se activan): estas
// dos reglas no la necesitan y pedirla multiplicaria el tiempo de la puerta por diez.
export default [
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.verify-out/**', 'release/**', 'coverage/**', '.claude/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    // Los `eslint-disable` que ya hay en el arbol apuntan a reglas base que esta configuracion NO
    // activa (p.ej. `no-control-regex`), asi que sin esto saldrian 2 avisos de "directiva sin usar" que
    // no significan nada: no sobran, es que aqui no corre la regla que desactivan.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Un hook detras de una guarda o dentro de un bucle rompe el arbol entero en runtime.
      'react-hooks/rules-of-hooks': 'error',
      // AVISO y no error: las deps mentidas son un bug de verdad (lo fue en BlockChat), pero hay
      // efectos deliberadamente con deps parciales en este arbol y convertirlos todos en error de
      // golpe cerraria la puerta el primer dia. Se sube a 'error' cuando la cuenta llegue a cero.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
