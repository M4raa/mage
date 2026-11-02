// Errores propios del host 1.2: cada uno sale al cliente con su código JSON-RPC (ver `toErrorBody`).

export class TrustRequiredError extends Error {
  constructor(readonly cwd: string) {
    super(`La carpeta no es de confianza: ${cwd}. Ábrela una vez en Mage (o en el CLI de esa cuenta) y acepta el aviso de confianza; desde la terminal no se puede confiar en una carpeta.`);
    this.name = 'TrustRequiredError';
  }
}

export class UnknownAccountError extends Error {
  constructor(readonly accountId: string, readonly provider: string) {
    super(`No hay ninguna cuenta de ${provider} con id ${accountId} en este Mage`);
    this.name = 'UnknownAccountError';
  }
}

export class UnknownConversationError extends Error {
  constructor(readonly conversationId: string) {
    super(`La conversación ${conversationId} no está abierta en este Mage; reanudar una conversación cerrada desde la terminal todavía no está disponible`);
    this.name = 'UnknownConversationError';
  }
}

export class UnsupportedMethodError extends Error {
  constructor(readonly method: string) {
    super(`«${method}» todavía no está disponible en este host`);
    this.name = 'UnsupportedMethodError';
  }
}
