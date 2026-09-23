import { describe, expect, it } from 'vitest';
import { canChangeCwd, shortenPath } from './cwdChange';

describe('canChangeCwd', () => {
  it('canChangeCwd_conversacionNuevaSinSesion_loPermite', () => {
    expect(canChangeCwd({ hasLiveSession: false, hasResumeTarget: false })).toEqual({ allowed: true });
  });

  // El CLI guarda la transcripcion bajo projects/<cwd-codificado>: moverla en caliente la partiria.
  it('canChangeCwd_conSesionViva_loImpideConMotivo', () => {
    const verdict = canChangeCwd({ hasLiveSession: true, hasResumeTarget: false });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('se esperaba denegado');
    expect(verdict.reason).toMatch(/marcha/i);
  });

  it('canChangeCwd_conversacionQueSeReanuda_loImpideConMotivo', () => {
    const verdict = canChangeCwd({ hasLiveSession: false, hasResumeTarget: true });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('se esperaba denegado');
    expect(verdict.reason).toMatch(/anterior|creó/i);
  });

  // La sesion viva manda sobre el resume: es el motivo mas inmediato y el mas grave.
  it('canChangeCwd_ambosMotivos_reportaElDeLaSesionViva', () => {
    const verdict = canChangeCwd({ hasLiveSession: true, hasResumeTarget: true });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('se esperaba denegado');
    expect(verdict.reason).toMatch(/marcha/i);
  });
});

describe('shortenPath', () => {
  it('shorten_rutaCorta_laDevuelveIntacta', () => {
    expect(shortenPath('C:\\proj', 48)).toBe('C:\\proj');
  });

  it('shorten_rutaLargaWindows_conservaRaizYNombreDeCarpeta', () => {
    const result = shortenPath('C:\\Users\\usuario\\Documents\\trabajo\\clientes\\mage-frontend', 30);

    expect(result).toBe('C:\\…\\mage-frontend');
  });

  it('shorten_rutaLargaPosix_conservaRaizYNombreDeCarpeta', () => {
    const result = shortenPath('/home/usuario/proyectos/muy/anidados/mage', 25);

    expect(result).toBe('home/…/mage');
  });

  // Lo que identifica el proyecto es el NOMBRE de la carpeta: si hay que sacrificar algo, es el principio.
  it('shorten_nombreDeCarpetaEnorme_priorizaElFinal', () => {
    const result = shortenPath('/a/b/una-carpeta-con-un-nombre-larguisimo-de-verdad', 20);

    expect(result).toContain('una-carpeta-con-un-nombre-larguisimo-de-verdad');
    expect(result.startsWith('…')).toBe(true);
  });

  it('shorten_rutaSinSeparadoresUtiles_recortaPorElFinal', () => {
    const result = shortenPath('/carpetaunicaperomuymuylargadeverdad', 12);

    expect(result.startsWith('…')).toBe(true);
    expect(result.endsWith('deverdad')).toBe(true);
  });
});
