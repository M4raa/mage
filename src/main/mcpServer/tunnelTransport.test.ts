import { describe, expect, it, vi } from 'vitest';
import { TunnelTransport } from './tunnelTransport';

const REQUEST = { jsonrpc: '2.0', id: 1, method: 'tools/list' } as const;

describe('TunnelTransport', () => {
  it('receive_valid_onmessage', () => {
    const transport = new TunnelTransport(vi.fn());
    const onmessage = vi.fn();
    transport.onmessage = onmessage;

    transport.receive({ ...REQUEST });

    expect(onmessage).toHaveBeenCalledWith(REQUEST);
  });

  it('receive_invalid_onerrorWithoutContent', () => {
    const transport = new TunnelTransport(vi.fn());
    const onerror = vi.fn();
    const onmessage = vi.fn();
    transport.onerror = onerror;
    transport.onmessage = onmessage;

    transport.receive({ secret: 'SECRET_SENTINEL' });

    expect(onmessage).not.toHaveBeenCalled();
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(String(onerror.mock.calls[0]![0])).not.toContain('SECRET_SENTINEL');
  });

  it('send_writes', async () => {
    const write = vi.fn();
    const transport = new TunnelTransport(write);

    await transport.send({ jsonrpc: '2.0', id: 1, result: {} });

    expect(write).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('close_idempotentAndOnclose', async () => {
    const transport = new TunnelTransport(vi.fn());
    const onclose = vi.fn();
    transport.onclose = onclose;

    await transport.close();
    await transport.close();

    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('afterClose_sendAndReceiveIgnored', async () => {
    const write = vi.fn();
    const transport = new TunnelTransport(write);
    const onmessage = vi.fn();
    transport.onmessage = onmessage;
    await transport.close();

    await transport.send({ jsonrpc: '2.0', id: 1, result: {} });
    transport.receive({ ...REQUEST });

    expect(write).not.toHaveBeenCalled();
    expect(onmessage).not.toHaveBeenCalled();
  });
});
