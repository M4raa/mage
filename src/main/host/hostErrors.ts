import { localized, UserFacingError } from '@shared/i18n/localizedText';

// Errores propios del host: cada uno sale al cliente con su código JSON-RPC (ver `toErrorBody`) y como `UserFacingError`, así que viaja también como `LocalizedText` (1.6).

export class TrustRequiredError extends UserFacingError {
  constructor(readonly cwd: string) {
    super(localized('errors.host.trustRequired', { cwd }));
    this.name = 'TrustRequiredError';
  }
}

export class UnknownAccountError extends UserFacingError {
  constructor(readonly accountId: string, readonly provider: string) {
    super(localized('errors.host.unknownAccount', { provider, accountId }));
    this.name = 'UnknownAccountError';
  }
}

export class UnknownConversationError extends UserFacingError {
  constructor(readonly conversationId: string) {
    super(localized('errors.host.unknownConversation', { conversationId }));
    this.name = 'UnknownConversationError';
  }
}

export class UnsupportedMethodError extends UserFacingError {
  constructor(readonly method: string) {
    super(localized('errors.host.unsupportedMethod', { method }));
    this.name = 'UnsupportedMethodError';
  }
}

// Un cliente del host (terminal, MCP, widget) corre como el mismo usuario que el agente: si pudiera poner una sesión en
// «Omitir permisos», un agente que lea el token del host se saltaría la barrera de permisos. Solo la ventana lo activa.
export class BypassPermissionsBlockedError extends UserFacingError {
  constructor() {
    super(localized('errors.host.bypassPermissionsBlocked'));
    this.name = 'BypassPermissionsBlockedError';
  }
}
