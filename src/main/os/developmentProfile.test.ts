import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { developmentUserData } from './developmentProfile';

describe('perfil propio de desarrollo', () => {
  it('conserva el perfil de la aplicación empaquetada', () => {
    expect(developmentUserData(true, [], '/app-data')).toBeNull();
  });
  it('separa desarrollo antes de adquirir el lock', () => {
    expect(developmentUserData(false, [], '/app-data')).toBe(join('/app-data', 'mage-dev'));
  });
  it.each([['--user-data-dir=/verification'], ['--user-data-dir', '/verification']])(
    'respeta el perfil explícito: %s', (...argv) => {
      expect(developmentUserData(false, argv, '/app-data')).toBeNull();
    },
  );
});
