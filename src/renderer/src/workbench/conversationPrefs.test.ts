import { describe, expect, it } from 'vitest';
import { resolveReopenedTabPrefs, toConversationPrefs } from './conversationPrefs';

const BASE = { accountDefaultModel: 'sonnet', providerDefaultModel: null } as const;

describe('resolveReopenedTabPrefs', () => {
  it('resolveReopenedTabPrefs_indiceConLosTres_ganaElIndice', () => {
    const prefs = resolveReopenedTabPrefs({
      ...BASE,
      indexPrefs: { model: 'opus', effort: 'high', permissionMode: 'plan' },
    });

    expect(prefs).toEqual({ model: 'opus', effort: 'high', permissionMode: 'plan' });
  });

  it('resolveReopenedTabPrefs_indiceSinEffort_noPoneEffort', () => {
    const prefs = resolveReopenedTabPrefs({ ...BASE, indexPrefs: { model: 'opus' } });

    expect(prefs).toEqual({ model: 'opus' });
    expect('effort' in prefs).toBe(false); // un `effort: undefined` explicito acabaria persistido
  });

  it('resolveReopenedTabPrefs_sinIndice_caeAlComportamientoActual', () => {
    expect(resolveReopenedTabPrefs({ ...BASE, indexPrefs: null })).toEqual({ model: 'sonnet' });
  });

  it('resolveReopenedTabPrefs_sinIndice_respetaElModeloPorProveedor', () => {
    // HALLAZGO 3: `openConversation` no pasaba `providerDefaultModel`, asi que reabrir del historial se
    // saltaba el ajuste de "🧠 Modelos" que `createConversation` si respeta.
    const prefs = resolveReopenedTabPrefs({ ...BASE, indexPrefs: null, providerDefaultModel: 'opus' });

    expect(prefs.model).toBe('opus');
  });

  it('resolveReopenedTabPrefs_indiceConModelo_ganaAlModeloDelProveedor', () => {
    const prefs = resolveReopenedTabPrefs({
      ...BASE,
      providerDefaultModel: 'opus',
      indexPrefs: { model: 'haiku' },
    });

    expect(prefs.model).toBe('haiku');
  });

  it('resolveReopenedTabPrefs_permissionModeInvalidoEnDisco_caeADefault', () => {
    const prefs = resolveReopenedTabPrefs({
      ...BASE,
      indexPrefs: { model: 'opus', permissionMode: 'bypassPermissions' as never },
    });

    expect('permissionMode' in prefs).toBe(false); // nunca se arranca con un modo que el CLI no conoce
  });

  it('resolveReopenedTabPrefs_camposEnBlancoEnDisco_seIgnoran', () => {
    const prefs = resolveReopenedTabPrefs({ ...BASE, indexPrefs: { model: '   ', effort: '' } });

    expect(prefs).toEqual({ model: 'sonnet' });
  });
});

describe('toConversationPrefs', () => {
  it('toConversationPrefs_pestanaConLosTres_losGuardaTodos', () => {
    expect(toConversationPrefs({ model: 'opus', effort: 'high', permissionMode: 'plan' })).toEqual({
      model: 'opus',
      effort: 'high',
      permissionMode: 'plan',
    });
  });

  it('toConversationPrefs_sinEffort_loMandaVacioParaQueSeBorre', () => {
    // Con `undefined` el indice conservaria el esfuerzo viejo y la conversacion seguiria reabriendose
    // con un esfuerzo que el usuario acaba de quitar.
    expect(toConversationPrefs({ model: 'opus' })).toEqual({ model: 'opus', effort: '' });
  });
});
