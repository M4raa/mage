import { describe, expect, it } from 'vitest';
import { partitionForAccount } from './artifactWindow';

// Solo la parte PURA: la ventana en si depende de Electron y se revisa a mano (mismo criterio que
// oauthWindow). Lo que si hay que blindar es la partition, porque de ella depende que dos cuentas NO
// compartan sesion de claude.ai — que es el punto entero de 2.4.

describe('partitionForAccount', () => {
  const ACCOUNT = 'C:\\Users\\usuario\\.claude-p';

  it('partitionForAccount_mismaCuenta_devuelveSiempreLoMismo', () => {
    // Si el hash cambiara entre versiones, el usuario tendria que volver a iniciar sesion en todas sus
    // cuentas: la estabilidad es parte del contrato.
    expect(partitionForAccount(ACCOUNT)).toBe(partitionForAccount(ACCOUNT));
    expect(partitionForAccount(ACCOUNT)).toMatch(/^persist:mage-artifact-[0-9a-f]{16}$/);
  });

  it('partitionForAccount_cuentasDistintas_partitionsDistintas', () => {
    expect(partitionForAccount(ACCOUNT)).not.toBe(partitionForAccount('C:\\Users\\usuario\\.claude'));
  });

  it('partitionForAccount_rutaConCaracteresRaros_devuelvePartitionValida', () => {
    // El config dir trae separadores, dos puntos y puede traer espacios o acentos: nada de eso vale en
    // el nombre de una partition.
    const partition = partitionForAccount('/home/usuario ñ/.claude:raro');

    expect(partition).toMatch(/^persist:mage-artifact-[0-9a-f]{16}$/);
  });

  it('partitionForAccount_cadenaVacia_lanza', () => {
    expect(() => partitionForAccount('')).toThrow(/config dir vacio.*""/i);
    expect(() => partitionForAccount('   ')).toThrow(/config dir vacio/i);
  });
});
