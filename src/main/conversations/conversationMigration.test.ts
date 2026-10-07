import { describe, expect, it, vi } from 'vitest';
import type { MigrateConversationParams } from '@shared/conversations';
import type { NeutralConversation } from '@shared/neutralConversation';
import { ConversationMigrationService, type ConversationSink, type ConversationSource, type MigrationEndpoints } from './conversationMigration';

const CONVERSATION: NeutralConversation = {
  cwd: 'C:\\p',
  title: 't',
  items: [{ kind: 'user', text: 'hola', atMs: null }, { kind: 'assistant', text: 'ok', atMs: null }],
};
const PARAMS: MigrateConversationParams = { sourceAccountDir: 'A', sourceProvider: 'codex', sessionId: 's1', cwd: 'C:\\p', privacy: 'shared', destAccountDir: 'B', destProvider: 'claude' };

function endpoints(over: { source?: Partial<ConversationSource>; sink?: Partial<ConversationSink> } = {}): MigrationEndpoints {
  const source: ConversationSource = { read: () => CONVERSATION, remove: vi.fn().mockResolvedValue(undefined), ...over.source };
  const sink: ConversationSink = { write: vi.fn(() => ({ sessionId: 'nuevo', configDir: 'B' })), discard: vi.fn().mockResolvedValue(undefined), ...over.sink };
  return { source, sink };
}

function service(origin: MigrationEndpoints, target: MigrationEndpoints, other: MigrationEndpoints = endpoints()): ConversationMigrationService {
  return new ConversationMigrationService({ codex: origin, claude: target, agy: other });
}

describe('ConversationMigrationService.migrate', () => {
  it('migrate_conversacionValida_escribeComprueba_yRetiraElOrigen', async () => {
    const origin = endpoints();
    const target = endpoints();

    const result = await service(origin, target).migrate(PARAMS);

    expect(result).toEqual({ sessionId: 'nuevo', configDir: 'B', provider: 'claude' });
    expect(target.sink.write).toHaveBeenCalledWith(CONVERSATION, { accountDir: 'B', privacy: 'shared' });
    expect(origin.source.remove).toHaveBeenCalledWith({ accountDir: 'A', sessionId: 's1', cwd: 'C:\\p', privacy: 'shared' });
  });

  it('migrate_laVerificacionLeeMenosMensajes_deshaceElDestinoYNoTocaElOrigen', async () => {
    const origin = endpoints();
    const target = endpoints({ source: { read: () => ({ ...CONVERSATION, items: [CONVERSATION.items[0]!] }) } });

    await expect(service(origin, target).migrate(PARAMS)).rejects.toThrow('solo se leyeron 1 de 2');

    expect(target.sink.discard).toHaveBeenCalledTimes(1);
    expect(origin.source.remove).not.toHaveBeenCalled();
  });

  it('migrate_laVerificacionFalla_deshaceElDestinoConElMotivo', async () => {
    const origin = endpoints();
    const target = endpoints({ source: { read: () => { throw new Error('base corrupta'); } } });

    await expect(service(origin, target).migrate(PARAMS)).rejects.toThrow('base corrupta');

    expect(target.sink.discard).toHaveBeenCalledTimes(1);
    expect(origin.source.remove).not.toHaveBeenCalled();
  });

  it('migrate_conversacionVacia_noEscribeNada', async () => {
    const origin = endpoints({ source: { read: () => ({ ...CONVERSATION, items: [] }) } });
    const target = endpoints();

    await expect(service(origin, target).migrate(PARAMS)).rejects.toThrow('no tiene mensajes');

    expect(target.sink.write).not.toHaveBeenCalled();
  });

  it('migrate_mismaCuenta_lanza', async () => {
    await expect(service(endpoints(), endpoints()).migrate({ ...PARAMS, destAccountDir: 'A' })).rejects.toThrow('la misma');
  });

  it('migrate_entreCuentasDeClaude_lanzaPorqueSeMueve', async () => {
    await expect(service(endpoints(), endpoints()).migrate({ ...PARAMS, sourceProvider: 'claude' })).rejects.toThrow('se mueve, no se traduce');
  });

  it('migrate_mismoProveedorConCopia_copiaSinTraducir', async () => {
    const copyFrom = vi.fn(() => ({ sessionId: 's1', configDir: 'B' }));
    const origin = endpoints();
    const target = endpoints({ sink: { copyFrom } });

    const result = await new ConversationMigrationService({ codex: { source: origin.source, sink: target.sink }, claude: endpoints(), agy: endpoints() }).migrate({ ...PARAMS, destProvider: 'codex' });

    expect(copyFrom).toHaveBeenCalledTimes(1);
    expect(target.sink.write).not.toHaveBeenCalled();
    expect(result.provider).toBe('codex');
  });

  it('migrate_origenSinCwd_usaElDeLosParametrosAlEscribir', async () => {
    const origin = endpoints({ source: { read: () => ({ ...CONVERSATION, cwd: '' }) } });
    const target = endpoints();

    await service(origin, target).migrate(PARAMS);

    expect(target.sink.write).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'C:\\p' }), expect.anything());
  });
});
