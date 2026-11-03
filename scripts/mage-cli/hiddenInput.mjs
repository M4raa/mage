// Entrada sin eco para la terminal (F7): mientras está activa, readline no repite lo que se escribe (contraseñas de
// una elicitation y, en `mage account add`, la clave de API). Usa `_writeToOutput`, el punto que readline de Node
// llama para cada eco; sin terminal (stdin no es TTY) no hay eco que quitar.
export function installMute(rl) {
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => {
    if (!muted) write(text);
  };
  return (value) => {
    if (typeof value !== 'boolean') throw new Error(`installMute espera un booleano: ${String(value)}`);
    muted = value;
  };
}
