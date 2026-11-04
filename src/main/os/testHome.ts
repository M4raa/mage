// HOME de PRUEBA para verify:gui (V6): el harness aísla `userData`, pero las cuentas, su historial y sus MCP se descubren
// colgando del HOME; sin esto el lateral de todas las cuentas (D6) enseñaba las conversaciones reales del usuario.
// Solo sin empaquetar y solo una ruta absoluta (patrón de `MAGE_TEST_LIBRARY_CLAUDE_DIR` y T6). null = el HOME real.
import { isAbsolute, resolve } from 'node:path';

export const TEST_HOME_ENV = 'MAGE_TEST_HOME';

export interface TestHomeInput {
  readonly env: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
}

export function decideTestHome(input: TestHomeInput): string | null {
  const value = input.env[TEST_HOME_ENV];
  if (input.isPackaged || value === undefined || value === '' || !isAbsolute(value)) return null;
  return resolve(value);
}

// El HOME para descubrir y validar cuentas: el de prueba si lo hay, si no el real.
export function accountsHomeFrom(testHome: string | null, realHome: string): string {
  return testHome ?? realHome;
}
