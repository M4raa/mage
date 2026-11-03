import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// Transporte MCP sobre el túnel `mcp.message` del host (1.5, D-M5): lo que el servidor envía sale por `write` y
// lo que el cliente manda entra por `receive`. Un mensaje inválido se avisa SIN su contenido (puede traer secretos).
export class TunnelTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];
  private closed = false;

  constructor(private readonly write: (message: Record<string, unknown>) => void) {}

  start(): Promise<void> {
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (!this.closed) this.write(message as unknown as Record<string, unknown>);
    return Promise.resolve();
  }

  receive(raw: Record<string, unknown>): void {
    if (this.closed) return;
    const parsed = JSONRPCMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.onerror?.(new Error('Mensaje MCP inválido del cliente'));
      return;
    }
    this.onmessage?.(parsed.data);
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.onclose?.();
    return Promise.resolve();
  }
}
