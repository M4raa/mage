import type { MageEvent } from '@shared/events';
import type { SessionSettings } from './delegatedSettings';

// Lo que main sabe del modelo, el esfuerzo y el modo de cada sesión viva: lo hereda una delegada. Se anota al lanzar y se
// actualiza con los cambios de la ventana y del host y con el `permission_mode` del CLI (el modo real, venga de donde venga).
// ponytail: las entradas no se borran al cerrar la sesión (unas decenas de bytes por sesión y arranque de Mage); borrar al
// cerrar si algún día hiciera falta.
export type SettingKey = 'model' | 'effort' | 'permissionMode';

export class SessionSettingsRegistry {
  private readonly bySession = new Map<string, SessionSettings>();

  record(sessionId: string, settings: SessionSettings): void {
    this.bySession.set(sessionId, settings);
  }

  // El esfuerzo vacío es «el del modelo»: se guarda como ausente.
  apply(sessionId: string, key: SettingKey, value: string): void {
    const current = this.bySession.get(sessionId);
    if (current === undefined) return;
    const { [key]: _previous, ...rest } = current;
    this.bySession.set(sessionId, value.length === 0 ? rest : { ...rest, [key]: value });
  }

  observe(sessionId: string, event: MageEvent): void {
    if (event.kind === 'permission_mode') {
      this.apply(sessionId, 'permissionMode', event.mode);
      return;
    }
    if (event.kind !== 'conversation_reset') return;
    // `/clear` abre otra conversación en el mismo proceso con otro id: lo sabido sigue valiendo.
    const current = this.bySession.get(sessionId);
    if (current !== undefined) this.bySession.set(event.newSessionId, current);
  }

  get(sessionId: string): SessionSettings | null {
    return this.bySession.get(sessionId) ?? null;
  }
}

export function settingsOfLaunch(params: { readonly provider: string; readonly model: string; readonly effort?: string; readonly permissionMode?: string }): SessionSettings {
  return {
    provider: params.provider,
    model: params.model,
    ...(params.effort === undefined || params.effort.length === 0 ? {} : { effort: params.effort }),
    ...(params.permissionMode === undefined ? {} : { permissionMode: params.permissionMode }),
  };
}
