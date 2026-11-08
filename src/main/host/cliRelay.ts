import { join } from 'node:path';

// `Mage.AppImage --cli <argumentos>` (F7.4): el AppImage no deja un `mage` en el PATH, así que main releva los
// argumentos al cliente de terminal empaquetado con el propio binario en modo Node y sale con su código. Puro.

export const CLI_FLAG = '--cli';

// Lo que va detrás de `--cli`, o null si no se pidió el relevo.
export function cliRelayArgs(argv: readonly string[]): readonly string[] | null {
  const index = argv.indexOf(CLI_FLAG);
  return index === -1 ? null : argv.slice(index + 1);
}

export interface CliRelayPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function cliRelayPlan(input: { readonly execPath: string; readonly resourcesPath: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string | undefined>> }): CliRelayPlan {
  return {
    command: input.execPath,
    args: [join(input.resourcesPath, 'cli', 'mage.mjs'), ...input.args],
    env: { ...input.env, ELECTRON_RUN_AS_NODE: '1' },
  };
}
