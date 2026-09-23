// Contrato del WIDGET FLOTANTE (M3). Snapshot compacto y de SOLO PRESENTACION que el renderer
// principal calcula y empuja a la ventana del widget (via main). SEGURIDAD: nunca lleva tokens,
// credenciales, oauthAccount ni rutas sensibles; solo titulos, %, estado y textos de alerta.

// Estado de un agente/pestana tal como lo muestra el widget. Identico a ChatStatus del renderer
// (renderer/.../types.ts) pero redeclarado aqui para no acoplar el contrato compartido al renderer.
export type WidgetAgentStatus = 'idle' | 'streaming' | 'needs_permission' | 'error';

// Un agente en el widget: una pestana con su cuenta, acento y estado. `tabId` permite el "mando a
// distancia" (clic -> activar esa pestana en la ventana principal).
export interface WidgetAgent {
  readonly tabId: string;
  readonly title: string;
  readonly accountAlias: string;
  readonly accentBase: string; // color de acento (puede ser un var(--mg-accent-*) de index.css)
  readonly status: WidgetAgentStatus;
}

// Ventana de uso en el widget (forma minima compartida; equivale a UsageWindow del renderer).
export interface WidgetUsageWindow {
  readonly pct: number; // 0..100
  readonly label: string; // cuenta atras hasta el reset ("1 h 24 m")
}

export interface WidgetUsage {
  readonly fiveHour: WidgetUsageWindow;
  readonly weekly: WidgetUsageWindow;
}

// Alerta compacta: uso sobre umbral, permiso pendiente o error de una pestana.
export interface WidgetAlert {
  readonly kind: 'usage' | 'permission' | 'error';
  readonly severity: 'warn' | 'critical';
  readonly text: string;
}

// Snapshot completo que consume la ventana del widget. `theme` viaja en el snapshot para que el
// widget conmute claro/oscuro al instante cuando el usuario cambia el tema en la app principal.
export interface WidgetSnapshot {
  readonly theme: 'light' | 'dark';
  readonly agents: readonly WidgetAgent[];
  readonly usage: WidgetUsage | null; // null si no hay cuenta activa / sin datos de uso
  readonly alerts: readonly WidgetAlert[];
  // Overrides de --color-mg-* de un tema importado activo (Open VSX); ausente = tema base por data-theme.
  readonly tokenOverrides?: Readonly<Record<string, string>>;
}
