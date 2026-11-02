// `mage stop` (U18) y `mage account add` (cuenta de API) sobre un enlace ya verificado con el host (F7). La E/S
// llega por parámetro.

export const EXIT_OK = 0;
// Distinto de `EXIT_TRUST_REQUIRED` de targetPicker.mjs (3, «carpeta sin confianza»): 4 = el host se negó.
export const EXIT_REFUSED = 4;

// Con `active` y sin `--force`, pregunta (si hay terminal) y reintenta con `force: true`.
export async function runStop({ rpc, force, confirm, write, messages }) {
  const result = await rpc.call('host.stop', { force });
  if (result.outcome === 'stopping') {
    write(messages.stopping());
    return EXIT_OK;
  }
  if (result.reason === 'gui') {
    write(messages.stopGui());
    return EXIT_REFUSED;
  }
  if (result.reason !== 'active') throw new Error(`Respuesta de host.stop no reconocida: ${JSON.stringify(result)}`);
  write(messages.stopActive(result.sessions));
  if (!force && confirm !== null && (await confirm(messages.stopConfirm()))) {
    return runStop({ rpc, force: true, confirm, write, messages });
  }
  write(messages.stopUseForce());
  return EXIT_REFUSED;
}

// La clave solo viaja al host: nunca se escribe ni acaba en un mensaje de error.
export async function runAccountAdd({ rpc, provider, name, readKey, write, messages }) {
  const key = (await readKey()).trim();
  if (key === '') throw new Error('No se recibió ninguna clave de API');
  const { account } = await rpc.call('accounts.create', { provider, name, apiKey: key });
  write(messages.accountAdded(account));
  return EXIT_OK;
}
