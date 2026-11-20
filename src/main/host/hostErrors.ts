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

// El cliente se presentó solo con el token de arranque (o su sesión de Mage ya no vive) y pidió algo que exige estar
// emparejado: crear, enviar, cambiar opciones, contestar, el túnel MCP…
export class NotPairedError extends UserFacingError {
  constructor() {
    super(localized('errors.host.notPaired'));
    this.name = 'NotPairedError';
  }
}

// `host.pair` sin permiso: el usuario dijo «Rechazar», no contestó a tiempo o no hay ventana a la que preguntar.
export type PairingRefusal = 'rejected' | 'timeout' | 'noWindow';
const REFUSAL_KEYS = {
  rejected: 'errors.host.pairRejected',
  timeout: 'errors.host.pairTimeout',
  noWindow: 'errors.host.pairNoWindow',
} as const satisfies Readonly<Record<PairingRefusal, string>>;

export class PairingRefusedError extends UserFacingError {
  constructor(readonly reason: PairingRefusal) {
    super(localized(REFUSAL_KEYS[reason]));
    this.name = 'PairingRefusedError';
  }
}

// Revisión de seguridad, H1 (opción b): contestar permisos desde un cliente del host está apagado salvo que el usuario lo
// encienda en Configuración. Un agente que lea el token del host no puede aprobarse sus propios permisos.
export class PermissionAnswersDisabledError extends UserFacingError {
  constructor() {
    super(localized('errors.host.permissionAnswersDisabled'));
    this.name = 'PermissionAnswersDisabledError';
  }
}
