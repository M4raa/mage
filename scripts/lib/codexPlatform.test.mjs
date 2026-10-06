import { describe, expect, it } from 'vitest';
import { safeSleep } from '../../spike/codex-real-verification.mjs';

describe('safeSleep', () => {
  it.each(['linux', 'darwin'])('safeSleep_esperaPosix_%s_aceptaSoloLaOperacionControlada', (platform) => {
    const command = '/bin/sleep 20';

    const result = safeSleep(command, platform);

    expect(result).toBe(true);
  });
  it('safeSleep_wrapperPosix_aceptaElShellMedido', () => {
    const result = safeSleep('/bin/bash -lc "/bin/sleep 20"', 'linux');

    expect(result).toBe(true);
  });
  it('safeSleep_windows_conservaLaEsperaControlada', () => {
    const result = safeSleep('powershell.exe -NoProfile -Command "Start-Sleep -Seconds 20"', 'win32');

    expect(result).toBe(true);
  });
  it.each(['/bin/sleep 21', '/bin/sleep 20; whoami', '/bin/sleep 20 | cat', '$(/bin/sleep 20)', '/bin/sleep 20\nwhoami'])('safeSleep_operacionAdicional_%s_rechaza', (command) => {
    const result = safeSleep(command, 'linux');

    expect(result).toBe(false);
  });
});
