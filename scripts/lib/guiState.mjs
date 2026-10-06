// Una comprobacion devuelve al siguiente caso el estado que recibio.
export async function withGuiState({ capture, prepare, run, restore }) {
  const previous = await capture();
  let failure;
  try {
    await prepare(previous);
    return await run(previous);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try { await restore(previous); }
    catch (error) {
      if (failure !== undefined) throw new AggregateError([failure, error], `Ejecucion: ${failure.message}; restauracion: ${error.message}`);
      throw error;
    }
  }
}
