const SLEEP_SECONDS = 20;

export function approvalSleep(platform) {
  return platform === 'win32' ? `powershell.exe -NoProfile -Command "Start-Sleep -Seconds ${SLEEP_SECONDS}"` : `/bin/sleep ${SLEEP_SECONDS}`;
}

export function safeSleep(command, platform) {
  if (typeof command !== 'string' || /[;&|`$\n\r]/.test(command)) return false;
  if (platform !== 'win32') {
    if (command.trim() === approvalSleep(platform)) return true;
    // Solo shells conocidos y un único argumento literal de espera; ninguna expansión.
    const wrapper = /^(?:["']?)(\/bin\/(?:bash|zsh|sh))(?:["']?)\s+-l?c\s+(["'])(.*?)\2$/.exec(command.trim());
    return wrapper !== null && wrapper[3] === approvalSleep(platform);
  }
  const unwrapped = command.replace(/^["'][A-Z]:\\[^"']*\\(?:pwsh|powershell)\.exe["']\s+(?:-NoProfile\s+)?-Command\s+/i, '').replace(/["']/g, '').trim();
  return unwrapped.toLowerCase() === approvalSleep(platform).replace(/["']/g, '').toLowerCase();
}
