import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { APP_RUN_CONFIG, HEADLESS_BLOCK, expectedAppRun, withHeadlessOzone } from './appRunHeadless.mjs';

const REPO_APP_RUN = new URL('../../resources/bin/AppRun', import.meta.url);

function generatedAppRun() {
  const fromBuilder = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
  return fromBuilder('app-builder-lib/out/targets/appimage/appImageUtil.js').generateAppRunScript(APP_RUN_CONFIG);
}

const countOf = (text, part) => text.split(part).length - 1;

describe('appRunHeadless', () => {
  it('appRun_ficheroDelRepo_igualAlGeneradoMasHeadless', () => {
    const actual = readFileSync(REPO_APP_RUN, 'utf8');

    expect(
      actual === expectedAppRun(),
      'resources/bin/AppRun no coincide con app-builder-lib: revisa el cambio y regenera con node scripts/lib/appRunHeadless.mjs --write',
    ).toBe(true);
  });

  it('withHeadlessOzone_scriptGenerado_bloqueAntesDeAtexitYEnLosDosExec', () => {
    const result = withHeadlessOzone(generatedAppRun());

    expect(countOf(result, HEADLESS_BLOCK)).toBe(1);
    expect(result.indexOf(HEADLESS_BLOCK)).toBeLessThan(result.indexOf('\natexit()\n'));
    expect(result).toContain('exec "$BIN" "${NO_SANDBOX[@]}" "${HEADLESS[@]}"\n');
    expect(result).toContain('exec "$BIN" "${NO_SANDBOX[@]}" "${HEADLESS[@]}" "${args[@]}"\n');
    expect(result).not.toContain('exec "$BIN" "${NO_SANDBOX[@]}"\n');
    expect(result).not.toContain('exec "$BIN" "${NO_SANDBOX[@]}" "${args[@]}"\n');
  });

  it('withHeadlessOzone_sinAncla_lanzaConElNombre', () => {
    expect(() => withHeadlessOzone('#!/bin/sh\n')).toThrow('atexit()');
  });

  it('withHeadlessOzone_dosVeces_lanza', () => {
    const once = withHeadlessOzone(generatedAppRun());

    expect(() => withHeadlessOzone(once)).toThrow(/AppRun de app-builder-lib cambió/);
  });
});
