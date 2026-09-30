import { describe, expect, it, vi } from 'vitest';
import { MAX_PROJECT_FILE_BYTES, ProjectFileService, type ProjectFileDeps } from './projectFileService';

const CWD = process.platform === 'win32' ? 'C:\\proj' : '/proj';
const FILE = process.platform === 'win32' ? 'C:\\proj\\plan.md' : '/proj/plan.md';
const OUTSIDE = process.platform === 'win32' ? 'C:\\otro\\secreto.md' : '/otro/secreto.md';
// Un plan del CLI: vive en `<configDir>/plans`, fuera del cwd de cualquier conversacion. Aqui se
// simula con el predicado inyectado, que en main es un whitelisting por patron bajo HOME.
const PLAN = process.platform === 'win32' ? 'C:\\Users\\u\\.claude\\plans\\mellow-seal.md' : '/home/u/.claude/plans/mellow-seal.md';

function service(files: Record<string, { readonly content: string; readonly mtimeMs: number }>, overrides: Partial<ProjectFileDeps> = {}) {
  const writeFile = vi.fn((path: string, content: string) => {
    files[path] = { content, mtimeMs: (files[path]?.mtimeMs ?? 0) + 1000 };
  });
  const svc = new ProjectFileService({
    exists: (path) => path in files,
    readFile: (path) => files[path]?.content ?? '',
    writeFile,
    mtimeMs: (path) => files[path]?.mtimeMs ?? null,
    byteLength: (path) => Buffer.byteLength(files[path]?.content ?? '', 'utf8'),
    // Por defecto NADA de fuera del cwd: cada test que quiera la segunda raiz la declara.
    isAllowedOutsideCwd: () => false,
    isApprovedOutside: () => false,
    ...overrides,
  });
  return { svc, writeFile, files };
}

describe('ProjectFileService.read', () => {
  it('read_ficheroDentroDelCwd_devuelveContenidoYMtime', () => {
    const { svc } = service({ [FILE]: { content: '# Plan', mtimeMs: 111 } });

    expect(svc.read({ cwd: CWD, path: FILE })).toEqual({ path: FILE, content: '# Plan', mtimeMs: 111, tooLarge: false });
  });

  it('read_ficheroQueNoExiste_contentNullSinLanzar', () => {
    // El agente pudo crearlo y borrarlo despues: se dice, no se finge un fichero vacio.
    const { svc } = service({});

    expect(svc.read({ cwd: CWD, path: FILE })).toEqual({ path: FILE, content: null, mtimeMs: null, tooLarge: false });
  });

  it('read_ficheroVacio_devuelveCadenaVacia', () => {
    // Vacio no es lo mismo que ausente.
    const { svc } = service({ [FILE]: { content: '', mtimeMs: 5 } });

    expect(svc.read({ cwd: CWD, path: FILE })).toMatchObject({ content: '', mtimeMs: 5 });
  });

  it('read_ficheroEnorme_noLoCargaYLoDice', () => {
    const { svc } = service({ [FILE]: { content: 'x', mtimeMs: 7 } }, { byteLength: () => MAX_PROJECT_FILE_BYTES + 1 });

    expect(svc.read({ cwd: CWD, path: FILE })).toMatchObject({ content: null, tooLarge: true });
  });

  it('read_fueraDelCwdSinAprobar_devuelveOutsideCwd', () => {
    const { svc } = service({ [OUTSIDE]: { content: 'secreto', mtimeMs: 1 } });

    expect(svc.read({ cwd: CWD, path: OUTSIDE })).toMatchObject({ content: null, outsideCwd: true });
  });

  it('read_rutaConSaltoHaciaArriba_quedaFueraSinContenido', () => {
    // El caso que un `startsWith` de cadenas no detecta.
    const { svc } = service({});

    expect(svc.read({ cwd: CWD, path: '../otro/secreto.md' })).toMatchObject({ content: null, outsideCwd: true });
  });

  it('read_rutaHermanaConElMismoPrefijo_quedaFueraSinContenido', () => {
    // "C:\proj-otro" empieza por "C:\proj" y NO esta dentro: es el otro caso que mata al `startsWith`.
    const { svc } = service({});
    const hermana = process.platform === 'win32' ? 'C:\\proj-otro\\x.md' : '/proj-otro/x.md';

    expect(svc.read({ cwd: CWD, path: hermana })).toMatchObject({ content: null, outsideCwd: true });
  });

  it('read_elPropioCwd_quedaFueraSinContenido', () => {
    const { svc } = service({});

    expect(svc.read({ cwd: CWD, path: CWD })).toMatchObject({ content: null, outsideCwd: true });
  });

  it('read_cwdVacio_lanzaConElValorRecibido', () => {
    const { svc } = service({});

    expect(() => svc.read({ cwd: '   ', path: FILE })).toThrow(/Carpeta de la conversación vacía/);
  });

  it('read_rutaVacia_lanza', () => {
    const { svc } = service({});

    expect(() => svc.read({ cwd: CWD, path: '' })).toThrow(/Ruta de fichero vacía/);
  });

  it('read_rutaRelativaDentroDelCwd_seResuelveContraElCwd', () => {
    const { svc } = service({ [FILE]: { content: '# Plan', mtimeMs: 3 } });

    expect(svc.read({ cwd: CWD, path: 'plan.md' })).toMatchObject({ path: FILE, content: '# Plan' });
  });
});

describe('ProjectFileService.write', () => {
  it('write_mtimeEsperadoCoincide_escribeYDevuelveElNuevo', () => {
    const { svc, writeFile } = service({ [FILE]: { content: 'viejo', mtimeMs: 100 } });

    const result = svc.write({ cwd: CWD, path: FILE, content: 'nuevo', expectedMtimeMs: 100 });

    expect(writeFile).toHaveBeenCalledWith(FILE, 'nuevo');
    expect(result).toMatchObject({ content: 'nuevo', mtimeMs: 1100 });
  });

  it('write_ficheroCambiadoEnDisco_lanzaYNoEscribe', () => {
    // Compare-and-swap: pisar el cambio de otro en silencio es el peor final posible.
    const { svc, writeFile } = service({ [FILE]: { content: 'lo que escribio el agente', mtimeMs: 999 } });

    expect(() => svc.write({ cwd: CWD, path: FILE, content: 'lo mio', expectedMtimeMs: 100 })).toThrow(/cambió en disco/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('write_ficheroNuevoConMtimeEsperadoNull_escribe', () => {
    // El panel leyo "no existe" y guarda: es una creacion legitima, no un conflicto.
    const { svc, writeFile } = service({});

    svc.write({ cwd: CWD, path: FILE, content: 'nuevo', expectedMtimeMs: null });

    expect(writeFile).toHaveBeenCalledWith(FILE, 'nuevo');
  });

  it('write_ficheroQueAparecioMientrasEditabas_lanza', () => {
    const { svc, writeFile } = service({ [FILE]: { content: 'lo puso otro', mtimeMs: 50 } });

    expect(() => svc.write({ cwd: CWD, path: FILE, content: 'lo mio', expectedMtimeMs: null })).toThrow(/cambió en disco/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('write_fueraDelCwdSinAprobar_lanza', () => {
    const { svc, writeFile } = service({});

    expect(() => svc.write({ cwd: CWD, path: OUTSIDE, content: 'x', expectedMtimeMs: null })).toThrow(/no está en la carpeta de la conversación/);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('ProjectFileService — planes del CLI (fuera del cwd)', () => {
  const permitirPlanes = { isAllowedOutsideCwd: (p: string) => p === PLAN };

  it('read_planDelCli_seAbreAunqueEsteFueraDelCwd', () => {
    // El caso del reporte: el panel listaba el plan (lo escribio un `Write` de esta conversacion) y
    // luego se negaba a abrirlo porque `~/.claude/plans` no esta bajo el cwd de nadie.
    const { svc } = service({ [PLAN]: { content: '# Plan', mtimeMs: 20 } }, permitirPlanes);

    expect(svc.read({ cwd: CWD, path: PLAN })).toMatchObject({ path: PLAN, content: '# Plan' });
  });

  it('write_planDelCli_seGuardaConElMismoCompareAndSwap', () => {
    const { svc, writeFile } = service({ [PLAN]: { content: 'viejo', mtimeMs: 20 } }, permitirPlanes);

    svc.write({ cwd: CWD, path: PLAN, content: 'nuevo', expectedMtimeMs: 20 });

    expect(writeFile).toHaveBeenCalledWith(PLAN, 'nuevo');
  });

  it('write_planDelCliCambiadoPorFuera_lanzaIgual', () => {
    const { svc, writeFile } = service({ [PLAN]: { content: 'lo cambio el agente', mtimeMs: 99 } }, permitirPlanes);

    expect(() => svc.write({ cwd: CWD, path: PLAN, content: 'lo mio', expectedMtimeMs: 20 })).toThrow(/cambió en disco/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('read_rutaDeFueraQueElWhitelistNoReconoce_sigueSinAbrirse', () => {
    // La segunda raiz no abre la mano a cualquier ruta de fuera: solo a la que main reconoce.
    const { svc } = service({ [OUTSIDE]: { content: 'secreto', mtimeMs: 1 } }, permitirPlanes);

    expect(svc.read({ cwd: CWD, path: OUTSIDE })).toMatchObject({ content: null, outsideCwd: true });
  });
});

describe('ProjectFileService — fuera del cwd aprobado por el usuario (P-028, 15)', () => {
  const aprobado = { isApprovedOutside: (p: string) => p === OUTSIDE };

  it('read_fueraAprobado_devuelveElContenido', () => {
    const { svc } = service({ [OUTSIDE]: { content: 'nota', mtimeMs: 5 } }, aprobado);

    expect(svc.read({ cwd: CWD, path: OUTSIDE })).toEqual({ path: OUTSIDE, content: 'nota', mtimeMs: 5, tooLarge: false });
  });

  it('write_fueraAprobado_escribe', () => {
    const { svc, writeFile } = service({ [OUTSIDE]: { content: 'viejo', mtimeMs: 5 } }, aprobado);

    svc.write({ cwd: CWD, path: OUTSIDE, content: 'nuevo', expectedMtimeMs: 5 });

    expect(writeFile).toHaveBeenCalledWith(OUTSIDE, 'nuevo');
  });

  it('write_fueraAprobadoCambiadoEnDisco_lanzaIgual', () => {
    const { svc, writeFile } = service({ [OUTSIDE]: { content: 'otro', mtimeMs: 9 } }, aprobado);

    expect(() => svc.write({ cwd: CWD, path: OUTSIDE, content: 'x', expectedMtimeMs: 5 })).toThrow(/cambió en disco/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('read_aprobarUnFichero_noApruebaSusVecinos', () => {
    const vecino = process.platform === 'win32' ? 'C:\\otro\\vecino.md' : '/otro/vecino.md';
    const { svc } = service({ [vecino]: { content: 'x', mtimeMs: 1 } }, aprobado);

    expect(svc.read({ cwd: CWD, path: vecino })).toMatchObject({ content: null, outsideCwd: true });
  });
});
