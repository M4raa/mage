import { describe, expect, it } from 'vitest';
import type { SessionBase } from '../engine/sessionFactory';
import { buildRuntimeSession, type RuntimeEnv } from './runtimeFactory';

describe('buildRuntimeSession', () => {
  it('buildRuntimeSession_proveedorBorrado_lanzaLaClaveConElIdEntreComillas', () => {
    const env = { findProvider: () => null } as unknown as RuntimeEnv;

    expect(() => buildRuntimeSession('custom:otro', {} as SessionBase, env)).toThrow(
      expect.objectContaining({ localized: { key: 'errors.runtime.providerNotConfigured', values: { provider: '"custom:otro"' } } }),
    );
  });
});
