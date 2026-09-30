// Importar un fichero como texto con el sufijo `?raw` de Vite (lo usa el changelog). Va en su propio
// fichero y no en global.d.ts: alli hay un `export {}`, y un modulo con comodin solo se puede declarar
// en un fichero de declaraciones que no sea un modulo.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
