import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import { notificationForEvent } from './notify';

describe('notificationForEvent', () => {
  it('result_avisaDeTurnoCompletadoConElTitulo', () => {
    const content = notificationForEvent({ kind: 'result' } as MageEvent, { tabTitle: 'mi-proyecto' });

    expect(content).toEqual({ title: 'Turno completado', body: 'mi-proyecto' });
  });

  it('permissionRequest_incluyeElNombreDeLaTool', () => {
    const event = {
      kind: 'permission_request',
      request: { requestId: 'r1', toolUseId: 'u1', toolName: 'Bash', input: {}, description: null },
    } as MageEvent;

    expect(notificationForEvent(event, { tabTitle: 'proj' })).toEqual({ title: 'Permiso requerido', body: 'proj: Bash' });
  });

  it('notificationForEvent_permisoAutoPermitido_null', () => {
    // «Permitir siempre aqui» ya contesto la peticion: el usuario no tiene nada que hacer.
    const event = {
      kind: 'permission_request',
      request: { requestId: 'r1', toolUseId: 'u1', toolName: 'Bash', input: {}, description: null },
    } as MageEvent;

    expect(notificationForEvent(event, { tabTitle: 'proj', autoAllowed: true })).toBeNull();
  });

  it('notificationForEvent_permisoPendiente_notifica', () => {
    const event = {
      kind: 'permission_request',
      request: { requestId: 'r1', toolUseId: 'u1', toolName: 'Write', input: {}, description: null },
    } as MageEvent;

    expect(notificationForEvent(event, { tabTitle: 'proj', autoAllowed: false })?.title).toBe('Permiso requerido');
  });

  it('error_incluyeElMensaje', () => {
    const content = notificationForEvent({ kind: 'error', message: 'boom' } as MageEvent, { tabTitle: 'proj' });

    expect(content).toEqual({ title: 'Error en la conversación', body: 'proj: boom' });
  });

  it('eventosDeRuido_devuelvenNull', () => {
    expect(notificationForEvent({ kind: 'stream_delta', text: 'x' } as MageEvent, { tabTitle: 'proj' })).toBeNull();
    expect(notificationForEvent({ kind: 'tool_result' } as MageEvent, { tabTitle: 'proj' })).toBeNull();
  });

  it('hookNotification_usaElMensajeDelCli', () => {
    // Fuente FIABLE de "necesito atencion": lo dice el CLI, no una regex sobre su texto.
    const event: MageEvent = {
      kind: 'hook_fired',
      requestId: 'r1',
      event: 'Notification',
      detail: 'Claude está esperando tu confirmación',
    };

    expect(notificationForEvent(event, { tabTitle: 'proj' })).toEqual({
      title: 'Claude necesita tu atención',
      body: 'proj: Claude está esperando tu confirmación',
    });
  });

  it('hookNotificationSinDetalle_caeAlTituloDeLaPestana', () => {
    const event: MageEvent = { kind: 'hook_fired', requestId: 'r1', event: 'Notification', detail: null };

    expect(notificationForEvent(event, { tabTitle: 'proj' })).toEqual({ title: 'Claude necesita tu atención', body: 'proj' });
  });

  it('hookSubagentStop_avisaDelSubagente', () => {
    const event: MageEvent = { kind: 'hook_fired', requestId: 'r1', event: 'SubagentStop', detail: null };

    expect(notificationForEvent(event, { tabTitle: 'proj' })).toEqual({ title: 'Subagente terminado', body: 'proj' });
  });

  it('hookStop_noNotifica_paraNoDuplicarElResult', () => {
    // `result` ya avisa de "Turno completado": notificar tambien el hook Stop seria spam.
    const event: MageEvent = { kind: 'hook_fired', requestId: 'r1', event: 'Stop', detail: null };

    expect(notificationForEvent(event, { tabTitle: 'proj' })).toBeNull();
  });

  it('hooksDeCicloDeVida_noNotifican', () => {
    for (const hook of ['UserPromptSubmit', 'PreCompact', 'SessionEnd', 'Desconocido']) {
      const event: MageEvent = { kind: 'hook_fired', requestId: 'r1', event: hook, detail: null };

      expect(notificationForEvent(event, { tabTitle: 'proj' })).toBeNull();
    }
  });
});

describe('notificationForEvent con reglas regex (assistant_text)', () => {
  const textEvent = (text: string): MageEvent => ({ kind: 'assistant_text', text });
  const rule = (pattern: string, overrides: Partial<{ label: string; enabled: boolean }> = {}) => ({
    id: 'r1',
    label: overrides.label ?? 'Deploy',
    pattern,
    enabled: overrides.enabled ?? true,
  });

  it('assistantText_reglaQueCasa_notificaConLabelYExtracto', () => {
    const content = notificationForEvent(textEvent('El deploy listo en prod'), { tabTitle: 'proj', rules: [rule('deploy listo')] });

    expect(content).toEqual({ title: 'Coincidencia: Deploy', body: 'proj: El deploy listo en prod' });
  });

  it('assistantText_sinCoincidencia_devuelveNull', () => {
    expect(notificationForEvent(textEvent('otra cosa'), { tabTitle: 'proj', rules: [rule('deploy listo')] })).toBeNull();
  });

  it('assistantText_reglaDesactivada_noNotifica', () => {
    expect(notificationForEvent(textEvent('deploy listo'), { tabTitle: 'proj', rules: [rule('deploy listo', { enabled: false })] })).toBeNull();
  });

  it('assistantText_regexInvalida_seIgnoraSinLanzar', () => {
    expect(notificationForEvent(textEvent('lo que sea'), { tabTitle: 'proj', rules: [rule('([invalida')] })).toBeNull();
  });

  it('assistantText_variasReglas_ganaLaPrimeraQueCasa', () => {
    const rules = [
      { id: 'a', label: 'NoCasa', pattern: 'zzz', enabled: true },
      { id: 'b', label: 'Tests', pattern: 'tests? en verde', enabled: true },
      { id: 'c', label: 'Tambien', pattern: 'verde', enabled: true },
    ];

    const content = notificationForEvent(textEvent('369 tests en verde'), { tabTitle: 'proj', rules: rules });

    expect(content?.title).toBe('Coincidencia: Tests');
  });

  it('assistantText_sinReglas_devuelveNull', () => {
    expect(notificationForEvent(textEvent('texto'), { tabTitle: 'proj' })).toBeNull();
  });

  it('assistantText_textoLargo_recortaElExtracto', () => {
    const long = `deploy listo ${'x'.repeat(300)}`;
    const content = notificationForEvent(textEvent(long), { tabTitle: 'proj', rules: [rule('deploy listo')] });

    expect(content?.body.length).toBeLessThanOrEqual('proj: '.length + 121);
    expect(content?.body.endsWith('…')).toBe(true);
  });
});
