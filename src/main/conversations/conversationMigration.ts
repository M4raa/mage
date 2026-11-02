import type { AccountProviderId } from '@shared/accounts';
import type { MigrateConversationParams, MigrateConversationResult } from '@shared/conversations';
import type { NeutralConversation } from '@shared/neutralConversation';
import { localized, localizedWithParts, UserFacingError, wrapError, type LocalizedText } from '@shared/i18n/localizedText';
import type { ConversationPrivacy } from '@shared/state';

// Migrar una conversación a otra cuenta/proveedor SIN que deje de ser la misma: se lee en el formato del origen, se
// escribe en el nativo del destino (el CLI de destino la reanuda como suya, medido), se COMPRUEBA leyendo lo escrito
// y solo entonces se retira la de origen (decisión del usuario: la conversación se mueve). Si algo falla antes de ese
// último paso, el origen sigue intacto y lo escrito en el destino se deshace.

export interface ConversationRef {
  readonly accountDir: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly privacy: ConversationPrivacy;
}

export interface ConversationSource {
  read(ref: ConversationRef): Promise<NeutralConversation>;
  remove(ref: ConversationRef): Promise<void>;
}

export interface ConversationSink {
  write(conversation: NeutralConversation, dest: { readonly accountDir: string; readonly privacy: ConversationPrivacy }): { readonly sessionId: string; readonly configDir: string };
  // Deshace lo escrito por `write` (verificación fallida).
  discard(ref: ConversationRef): Promise<void>;
  // Copia sin pérdida entre cuentas del MISMO proveedor, si el CLI lo permite (Codex: el rollout, medido). null: esa
  // conversación no se puede copiar sin pérdida (Codex con revert: el rollout guarda el turno descartado) y se migra
  // leyendo y escribiendo, como entre proveedores.
  copyFrom?(source: ConversationRef, dest: { readonly accountDir: string; readonly privacy: ConversationPrivacy }): { readonly sessionId: string; readonly configDir: string } | null;
}

export interface MigrationEndpoints {
  readonly source: ConversationSource;
  readonly sink: ConversationSink;
}

export class ConversationMigrationService {
  constructor(private readonly endpoints: Readonly<Record<AccountProviderId, MigrationEndpoints>>) {}

  async migrate(params: MigrateConversationParams): Promise<MigrateConversationResult> {
    this.assertMigratable(params);
    const origin = this.endpoints[params.sourceProvider];
    const target = this.endpoints[params.destProvider];
    const ref: ConversationRef = { accountDir: params.sourceAccountDir, sessionId: params.sessionId, cwd: params.cwd, privacy: params.privacy };
    const conversation = await origin.source.read(ref);
    if (conversation.items.length === 0) throw new UserFacingError(localized('errors.conversations.migrationEmpty', { sessionId: params.sessionId }));
    const dest = { accountDir: params.destAccountDir, privacy: params.privacy };
    const copied = params.sourceProvider === params.destProvider ? target.sink.copyFrom?.(ref, dest) : undefined;
    const written = copied ?? target.sink.write({ ...conversation, cwd: conversation.cwd || params.cwd }, dest);
    // `configDir` ya es el directorio EFECTIVO (cuenta o perfil privado): no se vuelve a resolver la privacidad.
    const writtenRef: ConversationRef = { accountDir: written.configDir, sessionId: written.sessionId, cwd: conversation.cwd || params.cwd, privacy: 'shared' };
    await this.verifyOrDiscard(target, writtenRef, conversation.items.length);
    await origin.source.remove(ref);
    return { sessionId: written.sessionId, configDir: written.configDir, provider: params.destProvider };
  }

  private assertMigratable(params: MigrateConversationParams): void {
    if (params.sourceAccountDir === params.destAccountDir) throw new Error(`La cuenta de origen y la de destino son la misma: ${params.sourceAccountDir}`);
    if (params.sourceProvider === 'claude' && params.destProvider === 'claude') {
      throw new Error('Entre cuentas de Claude la conversacion se mueve, no se traduce');
    }
    if (!(params.sourceProvider in this.endpoints) || !(params.destProvider in this.endpoints)) {
      throw new Error(`Proveedor sin migracion: ${params.sourceProvider} -> ${params.destProvider}`);
    }
  }

  // Lo escrito se vuelve a leer con el lector del destino: si trae menos mensajes que el origen, se deshace.
  private async verifyOrDiscard(target: MigrationEndpoints, written: ConversationRef, expectedItems: number): Promise<void> {
    let found = 0;
    let failure: unknown = null;
    try {
      found = (await target.source.read(written)).items.length;
    } catch (err) {
      failure = err;
    }
    if (failure === null && found >= expectedItems) return;
    await target.sink.discard(written);
    throw new UserFacingError(verifyFailure(failure, found, expectedItems));
  }
}

// El motivo es el error del lector (de Mage o ajeno) o, si no falló pero faltan mensajes, la cuenta de los que se leyeron.
function verifyFailure(failure: unknown, found: number, expected: number): LocalizedText {
  if (failure instanceof Error) return wrapError('errors.conversations.migrationVerifyFailed', {}, failure);
  const detail = localized('errors.conversations.migrationVerifyShort', { found: String(found), expected: String(expected) });
  return localizedWithParts('errors.conversations.migrationVerifyFailed', {}, { detail });
}
