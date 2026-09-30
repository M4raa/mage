import { describe, expect, it } from 'vitest';
import { noticeTextFor } from './cliNotices';

describe('noticeTextFor', () => {
  it('noticeTextFor_compactadoManual_loDice', () => {
    expect(noticeTextFor({ kind: 'compacted', trigger: 'manual' })).toBe('Contexto compactado (manual)');
  });

  it('noticeTextFor_compactadoAuto_loDice', () => {
    expect(noticeTextFor({ kind: 'compacted', trigger: 'auto' })).toBe('Contexto compactado (automática)');
  });

  it('noticeTextFor_compactadoConTriggerDesconocido_caeAManual', () => {
    expect(noticeTextFor({ kind: 'compacted', trigger: 'lo-que-sea' })).toContain('manual');
  });

  it('noticeTextFor_modoDePermiso_traduceElVocabulario', () => {
    expect(noticeTextFor({ kind: 'permission_mode', mode: 'acceptEdits' })).toBe('Modo de permiso: auto-editar');
  });

  it('noticeTextFor_modoDePermisoDesconocido_pintaElCrudo', () => {
    // El CLI puede traer modos que Mage no conoce: es peor esconder el cambio que enseñar su nombre.
    expect(noticeTextFor({ kind: 'permission_mode', mode: 'modoNuevo' })).toBe('Modo de permiso: modoNuevo');
  });

  it('noticeTextFor_rateLimit_textoDeMageSinElDelCli', () => {
    // P-028, 20: el texto del CLI (en ingles) va al tooltip, no a la linea.
    const summary = "You've hit your session limit · resets 3pm (Europe/Madrid)";

    expect(noticeTextFor({ kind: 'rate_limit', summary, resetsAtMs: null })).toBe('Límite de uso alcanzado');
  });

  it('noticeTextFor_rateLimitConHora_diceCuandoSeRestablece', () => {
    const resetsAtMs = new Date(2026, 8, 29, 15, 0).getTime();

    expect(noticeTextFor({ kind: 'rate_limit', summary: '', resetsAtMs })).toMatch(/^Límite de uso alcanzado · se restablece a las .*15.*00/);
  });

  it('noticeTextFor_hookNotification_noVaAlHilo', () => {
    // 2.3b: el aviso "Claude necesita tu atención" se quito del hilo. Ese hook salta cuando el CLI pide
    // un permiso, y el permiso ahora se pinta como TARJETA con la accion y los botones: la linea avisaba
    // de algo que ya esta a la vista. Sigue usandose para la notificacion del SO (notify.ts).
    expect(noticeTextFor({ kind: 'hook_fired', requestId: 'r', event: 'Notification', detail: 'Necesito permiso' })).toBeNull();
    expect(noticeTextFor({ kind: 'hook_fired', requestId: 'r', event: 'Notification', detail: null })).toBeNull();
  });

  it('noticeTextFor_hookDeCicloDeVida_noVaAlHilo', () => {
    // `Stop` ya se ve por el fin de turno y `UserPromptSubmit` lo acaba de hacer el usuario: al hilo no.
    expect(noticeTextFor({ kind: 'hook_fired', requestId: 'r', event: 'Stop', detail: null })).toBeNull();
    expect(noticeTextFor({ kind: 'hook_fired', requestId: 'r', event: 'UserPromptSubmit', detail: null })).toBeNull();
  });

  it('noticeTextFor_eventoQueNoVaAlHilo_devuelveNull', () => {
    // Lo que no es un aviso se queda en el panel de Logs, que es para lo que existe.
    expect(noticeTextFor({ kind: 'stream_delta', text: 'hola' })).toBeNull();
    expect(noticeTextFor({ kind: 'commands_available', commands: [] })).toBeNull();
    expect(noticeTextFor({ kind: 'context_usage', usage: { totalTokens: 1, maxTokens: 2, percentage: 50, categories: [] } })).toBeNull();
  });
});
