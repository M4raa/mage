import { formatter } from '@lingui/format-json';

// Catálogos de la interfaz (F3, INFORME-033 con T1/T2 de DEVOLUCION-018): uno PLANO por idioma, en JSON
// `{ clave: mensaje ICU }`. Las claves las escribe la ejecutora a mano (ids explícitos, sin macros ni extracción):
// Lingui solo los COMPILA al importarlos (`@lingui/vite-plugin`, sufijo `?lingui`). `es` es la base; lo que falte
// en `en` cae al texto `es` al compilar (la paridad estricta llega con F3.5).
export default {
  sourceLocale: 'es',
  locales: ['es', 'en'],
  fallbackLocales: { en: 'es' },
  catalogs: [{ path: '<rootDir>/src/shared/i18n/catalogs/{locale}', include: [] }],
  format: formatter({ style: 'minimal' }),
};
