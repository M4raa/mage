import { describe, expect, it, vi } from 'vitest';
import { requireCodexSubscription } from './codexAccountBoundary';

describe('requireCodexSubscription', () => {
  it.each([null, 42, {}, '', '   '])('requireCodexSubscription_entradaInvalida_%s_rechazaAntesDeBuscar', (raw) => {
    const find = vi.fn(() => null);

    const act = () => requireCodexSubscription(raw, find);

    expect(act).toThrow('Directorio de cuenta inválido');
    expect(find).not.toHaveBeenCalled();
  });
  it('requireCodexSubscription_cuentaApi_rechazaLaCuenta', () => {
    const find = () => ({ providerId: 'codex' as const, authKind: 'api-key' as const, name: 'test', home: '/test' });

    const act = () => requireCodexSubscription('/test', find);

    expect(act).toThrow('Se requiere una cuenta de suscripción');
  });
  it('requireCodexSubscription_rutaNoRegistrada_rechazaLaCuenta', () => {
    const act = () => requireCodexSubscription('/missing', () => null);

    expect(act).toThrow('Se requiere una cuenta de suscripción');
  });
});
