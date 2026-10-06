// Una comprobacion devuelve al siguiente caso el estado que recibio.
export async function withGuiState({ capture, prepare, run, restore }) {
  const previous = await capture();
  try {
    await prepare(previous);
    return await run(previous);
  } finally { await restore(previous); }
}
