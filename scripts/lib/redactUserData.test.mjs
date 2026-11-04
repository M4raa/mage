import { describe, expect, it } from 'vitest';
import { redactLocalUser, redactUserData } from './redactUserData.mjs';

describe('redactUserData', () => {
  it('redactUserData_correoEnElTexto_loSustituye', () => {
    expect(redactUserData('rail: ana.perez+x@example.com activa', [])).toBe('rail: <correo> activa');
  });

  it('redactUserData_aliasYCorreo_sustituyeLosDos', () => {
    // El alias más largo va primero: «Ana Perez» no debe quedar a medias por culpa de «Ana».
    expect(redactUserData('Ana Perez · Ana · ana@example.com', ['Ana', 'Ana Perez'])).toBe('<cuenta> · <cuenta> · <correo>');
  });

  it('redactUserData_aliasCorto_noLoToca', () => {
    expect(redactUserData('cuenta Bo en uso', ['Bo'])).toBe('cuenta Bo en uso');
  });

  it('redactUserData_sinDatos_devuelveIgual', () => {
    expect(redactUserData('4 pestañas, sin cuentas', [])).toBe('4 pestañas, sin cuentas');
  });
});

describe('redactLocalUser', () => {
  const local = { home: 'C:\\Users\\ana', user: 'ana' };

  it('redactLocalUser_rutaConBarraInvertida_laTapa', () => {
    expect(redactLocalUser('C:\\Users\\ana\\x', local)).toBe('<home>\\x');
  });

  it('redactLocalUser_rutaConBarraYMayusculas_laTapa', () => {
    expect(redactLocalUser('c:/users/ANA/x', local)).toBe('<home>/x');
  });

  it('redactLocalUser_rutaEnJson_laTapa', () => {
    const out = redactLocalUser(JSON.stringify('C:\\Users\\ana\\x'), local);

    expect(out).toContain('<home>');
    expect(out).not.toContain('ana');
  });

  it('redactLocalUser_usuarioSuelto_loTapa', () => {
    expect(redactLocalUser('hola ana.', local)).toBe('hola <usuario>.');
  });

  it('redactLocalUser_usuarioDentroDePalabra_noLoToca', () => {
    expect(redactLocalUser('banana', local)).toBe('banana');
  });

  it('redactLocalUser_usuarioCorto_noLoToca', () => {
    expect(redactLocalUser('hola al.', { home: 'C:\\Users\\al', user: 'al' })).toBe('hola al.');
  });
});
