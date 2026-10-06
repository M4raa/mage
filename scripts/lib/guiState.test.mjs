import { describe, expect, it } from 'vitest';
import { withGuiState } from './guiState.mjs';

describe('withGuiState', () => {
  it('withGuiState_ejecucionYRestauracionFallan_conservaAmbosErrores', async () => {
    const runError = new Error('fallo de ejecución');
    const restoreError = new Error('fallo de restauración');
    const deps = { capture: async () => 'previo', prepare: async () => {},
      run: async () => { throw runError; }, restore: async () => { throw restoreError; },
    };

    const error = await withGuiState(deps).catch((error) => error);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([runError, restoreError]);
  });
  it('withGuiState_ejecucionFalla_restauraYPropagaElError', async () => {
    let state = 'anterior';
    const deps = { capture: async () => state, prepare: async () => { state = 'temporal'; },
      run: async () => { throw new Error('fallo artificial de ejecución'); }, restore: async (previous) => { state = previous; },
    };

    await expect(withGuiState(deps)).rejects.toThrow('fallo artificial de ejecución');

    expect(state).toBe('anterior');
  });

  it('withGuiState_casoCorrecto_devuelveResultadoTrasRestaurar', async () => {
    let state = 'anterior';
    const deps = { capture: async () => state, prepare: async () => { state = 'temporal'; },
      run: async () => 'resultado', restore: async (previous) => { state = previous; },
    };

    const result = await withGuiState(deps);

    expect(result).toBe('resultado');
    expect(state).toBe('anterior');
  });
  it('withGuiState_preparacionFalla_restauraAntesDelSiguienteCaso', async () => {
    let state = 'anterior';
    const deps = { capture: async () => state,
      prepare: async () => { state = 'pestaña-temporal'; throw new Error('fallo artificial de preparación'); },
      run: async () => true, restore: async (previous) => { state = previous; },
    };

    await expect(withGuiState(deps)).rejects.toThrow('fallo artificial de preparación');

    expect(state).toBe('anterior');
  });
});
