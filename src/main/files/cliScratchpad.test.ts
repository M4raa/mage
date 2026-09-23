import { describe, expect, it } from 'vitest';
import { isUnderCliScratchpad } from './cliScratchpad';

// Esto es una FRONTERA: lo que devuelva `true` queda abierto a lectura y escritura desde el renderer.
// Por eso hay más casos de rechazo que de aceptación — lo que importa no es que el scratchpad entre,
// es que no entre nada más del directorio temporal, donde escribe cualquier proceso de la máquina.

const TEMP = '/tmp';
const SCRATCH = `${TEMP}/claude/C--sourcecode-mage/a59c112d-401c/scratchpad`;

describe('isUnderCliScratchpad', () => {
  it('ficheroEnElScratchpad_loAcepta', () => {
    expect(isUnderCliScratchpad(TEMP, `${SCRATCH}/cuerpo-difusion.html`)).toBe(true);
  });

  it('raizConSufijoDeUid_laAcepta', () => {
    // `<temp>/claude-<uid>/…` es la forma que documenta scratchRetention.ts.
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/claude-1000/C--proj/sesion/scratchpad/plan.md`)).toBe(true);
  });

  it('subcarpetaDentroDelScratchpad_laAcepta', () => {
    expect(isUnderCliScratchpad(TEMP, `${SCRATCH}/sub/dir/nota.txt`)).toBe(true);
  });

  it('elPropioScratchpadSinFichero_loRechaza', () => {
    // Es la carpeta contenedora, no un fichero dentro: abrirla no significa nada.
    expect(isUnderCliScratchpad(TEMP, SCRATCH)).toBe(false);
  });

  it('otraCarpetaDeLaSesionQueNoEsScratchpad_laRechaza', () => {
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/claude/C--proj/sesion/otra/secreto.json`)).toBe(false);
  });

  it('tempDirectamente_loRechaza', () => {
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/cualquier-cosa.txt`)).toBe(false);
  });

  it('sinLasCuatroCapas_loRechaza', () => {
    // `<temp>/claude/fichero` no es un scratchpad de nadie: faltan slug y sesión.
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/claude/fichero.md`)).toBe(false);
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/claude/C--proj/scratchpad/x.md`)).toBe(false);
  });

  it('raizQueSoloEmpiezaPorClaude_laRechaza', () => {
    // "claudia" y "claude2" empiezan por "claude" pero no son la raíz del CLI: un `startsWith` los
    // habría dejado pasar, el patrón anclado no.
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/claudia/C--proj/sesion/scratchpad/x.md`)).toBe(false);
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/claude2/C--proj/sesion/scratchpad/x.md`)).toBe(false);
  });

  it('rutaQueSaleDelTemp_laRechaza', () => {
    expect(isUnderCliScratchpad(TEMP, '/etc/passwd')).toBe(false);
    expect(isUnderCliScratchpad(TEMP, `${TEMP}/../otro/claude/C--p/s/scratchpad/x.md`)).toBe(false);
  });

  it('tempHermanoConElMismoPrefijo_loRechaza', () => {
    // "/tmp-otro" empieza por "/tmp": es el caso que un `startsWith` confunde.
    expect(isUnderCliScratchpad(TEMP, '/tmp-otro/claude/C--p/s/scratchpad/x.md')).toBe(false);
  });

  it('tempVacio_loRechaza', () => {
    // Sin raíz conocida no se autoriza nada, en vez de comparar contra '' y aceptarlo todo.
    expect(isUnderCliScratchpad('', `${SCRATCH}/x.md`)).toBe(false);
    expect(isUnderCliScratchpad('   ', `${SCRATCH}/x.md`)).toBe(false);
  });
});
