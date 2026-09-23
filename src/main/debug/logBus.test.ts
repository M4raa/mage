import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '@shared/debug';
import { LogBus } from './logBus';

// Reloj fijo para timestamps deterministas.
const FIXED_CLOCK = () => '2026-07-10T00:00:00.000Z';

describe('LogBus', () => {
  it('publish_assignsIncrementingIdsAndTimestamp', () => {
    // Arrange
    const bus = new LogBus(FIXED_CLOCK);

    // Act
    const first = bus.publish('main', 'info', 'a');
    const second = bus.publish('engine', 'warn', 'b');

    // Assert
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(first.timestamp).toBe('2026-07-10T00:00:00.000Z');
  });

  it('publish_notifiesSubscribers', () => {
    // Arrange
    const bus = new LogBus(FIXED_CLOCK);
    const received: LogEntry[] = [];
    bus.subscribe((entry) => received.push(entry));

    // Act
    bus.publish('renderer', 'error', 'boom', { detail: 1 });

    // Assert
    expect(received).toHaveLength(1);
    expect(received[0]!.message).toBe('boom');
    expect(received[0]!.source).toBe('renderer');
  });

  it('publish_redactsSensitiveDataBeforeEmitting', () => {
    // Arrange
    const bus = new LogBus(FIXED_CLOCK);
    let captured: LogEntry | null = null;
    bus.subscribe((entry) => {
      captured = entry;
    });

    // Act
    bus.publish('engine', 'debug', 'spawn', { accessToken: 'sk-secret', model: 'opus' });

    // Assert: el token nunca llega al suscriptor.
    const data = captured!.data as Record<string, unknown>;
    expect(data.accessToken).toBe('[REDACTED]');
    expect(data.model).toBe('opus');
  });

  it('publish_withoutData_omitsDataField', () => {
    // Arrange
    const bus = new LogBus(FIXED_CLOCK);

    // Act
    const entry = bus.publish('main', 'info', 'sin data');

    // Assert
    expect('data' in entry).toBe(false);
  });

  it('subscribe_returnsUnsubscribeThatStopsDelivery', () => {
    // Arrange
    const bus = new LogBus(FIXED_CLOCK);
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);

    // Act
    unsubscribe();
    bus.publish('main', 'info', 'tras desuscribir');

    // Assert
    expect(listener).not.toHaveBeenCalled();
  });

  it('loggerFor_bindsSource', () => {
    // Arrange
    const bus = new LogBus(FIXED_CLOCK);
    let captured: LogEntry | null = null;
    bus.subscribe((entry) => {
      captured = entry;
    });
    const engineLog = bus.loggerFor('engine');

    // Act
    engineLog('warn', 'stderr del CLI');

    // Assert
    expect(captured!.source).toBe('engine');
    expect(captured!.level).toBe('warn');
  });
});
