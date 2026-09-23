import { describe, expect, it } from 'vitest';
import { pathEquals } from './pathUtils';

// De pathEquals cuelgan fronteras de seguridad (guardas de cuenta de AccountService y la deteccion de
// junctions de LinkService), asi que se cubren tambien los casos raros de forma de ruta.
describe('pathEquals', () => {
  it('pathEquals_mismaRuta_devuelveTrue', () => {
    expect(pathEquals('/home/u/.claude', '/home/u/.claude')).toBe(true);
  });

  it('pathEquals_rutasDistintas_devuelveFalse', () => {
    expect(pathEquals('/home/u/.claude', '/home/u/.claude-p')).toBe(false);
  });

  it('pathEquals_barraFinal_seIgnora', () => {
    // `normalize` CONSERVA la barra final: sin tratarla, un configDir con barra fallaria las guardas
    // de cuenta y la conversacion no arrancaria ("Ruta de cuenta no valida").
    expect(pathEquals('/home/u/.claude/', '/home/u/.claude')).toBe(true);
    expect(pathEquals('/home/u/.claude', '/home/u/.claude/')).toBe(true);
    expect(pathEquals('/home/u/.claude//', '/home/u/.claude')).toBe(true);
  });

  it('pathEquals_barraFinalEnWindows_seIgnora', () => {
    expect(pathEquals('C:\\Users\\u\\.claude\\', 'C:\\Users\\u\\.claude')).toBe(true);
  });

  it('pathEquals_raizPosix_noSeVaciaAlQuitarLaBarra', () => {
    // Quitarle la barra a "/" dejaria "": la raiz debe seguir comparandose consigo misma y no con nada.
    expect(pathEquals('/', '/')).toBe(true);
    expect(pathEquals('/', '')).toBe(false);
  });

  it('pathEquals_raizWindows_noSeConfundeConLaRutaRelativaALaUnidad', () => {
    // "C:\" (raiz de la unidad) y "C:" (ruta RELATIVA al directorio actual de esa unidad) no son la
    // misma cosa; el recorte de barra final no puede convertir una en la otra.
    expect(pathEquals('C:\\', 'C:\\')).toBe(true);
    expect(pathEquals('C:\\', 'C:')).toBe(false);
  });

  it('pathEquals_mayusculas_seIgnoran', () => {
    expect(pathEquals('/Home/U/.Claude', '/home/u/.claude')).toBe(true);
  });

  it('pathEquals_segmentosRedundantes_seResuelven', () => {
    expect(pathEquals('/home/u/./.claude', '/home/u/.claude')).toBe(true);
    expect(pathEquals('/home/u/x/../.claude', '/home/u/.claude')).toBe(true);
  });

  it('pathEquals_prefijoQueNoEsSegmentoCompleto_devuelveFalse', () => {
    // Guarda contra el fallo clasico de comparar por prefijo: mage-private NO es mage-private-old.
    expect(pathEquals('/home/u/.claude/mage-private', '/home/u/.claude/mage-private-old')).toBe(false);
  });

  it('pathEquals_rutaVaciaContraRutaReal_devuelveFalse', () => {
    expect(pathEquals('', '/home/u/.claude')).toBe(false);
  });

  it('pathEquals_ambasVacias_devuelveTrue', () => {
    // normalize('') es '.', asi que dos vacias siguen siendo iguales entre si (no coincide con nada mas).
    expect(pathEquals('', '')).toBe(true);
  });
});
