import { describe, expect, it } from 'vitest';
import { redactUserData } from './redactUserData.mjs';

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
