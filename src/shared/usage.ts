// Tipo de dominio del USO de una cuenta (un CLAUDE_CONFIG_DIR), derivado de GET /api/oauth/usage.
// Es SEGURO por diseno: NUNCA incluye el token OAuth ni ningun dato sensible; es lo unico que cruza
// el IPC main->renderer sobre uso. El token se lee en main (UsageService) solo para el header
// Authorization y jamas se emite. Dinero en enteros de "minor units"; porcentajes/tokens enteros.

// Una ventana de uso de la suscripcion (5h o 7 dias). `utilization` es el % consumido (entero grueso,
// con lag en el endpoint). `resetsAt` es el epoch ms del proximo reset (null si el endpoint no lo da).
export interface UsageWindowInfo {
  readonly utilization: number; // 0..100 (% consumido de la ventana)
  readonly resetsAt: number | null; // epoch ms del reset; null si ausente
}

// Un limite concreto del desglose `limits[]` (p.ej. por modelo/grupo). Permite las barras "por-modelo".
export interface UsageLimit {
  readonly kind: string; // p.ej. "model" | "overall" ...
  readonly group: string | null; // etiqueta del grupo/modelo (o null)
  readonly percent: number; // 0..100 consumido
  readonly severity: string | null; // severidad reportada por el endpoint (o null)
  readonly resetsAt: number | null; // epoch ms del reset (o null)
  readonly isActive: boolean; // si el limite esta activo
}

// Snapshot de uso agregado de una cuenta. `apiCreditsMinor` = spend.used.amount_minor en unidades
// menores (0 => no factura API, util para confirmar que se consume la suscripcion). `fetchedAt` es
// el epoch ms en que se obtuvo (para la cuenta atras relativa en el renderer).
export interface UsageInfo {
  readonly fiveHour: UsageWindowInfo;
  readonly sevenDay: UsageWindowInfo;
  readonly limits: readonly UsageLimit[];
  readonly apiCreditsMinor: number | null;
  readonly fetchedAt: number; // epoch ms
}
