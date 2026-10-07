import { describe, expect, it } from 'vitest';
import { adaptCodexLine } from '@shared/codexTranscript';
import type { NeutralConversation } from '@shared/neutralConversation';
import { agyStepsToLines } from './agyHistory';
import { agyDbContent, claudeTranscriptText, codexRolloutRelativePath, codexRolloutText } from './nativeWriters';
import { neutralFromLines } from './neutralReader';

const CONVERSATION: NeutralConversation = {
  cwd: 'C:\\proyecto',
  title: 'Lista los ficheros',
  items: [
    { kind: 'user', text: 'Recuerda CIRUELA y lista los ficheros', atMs: Date.parse('2026-10-05T08:00:00Z') },
    { kind: 'tool', id: 'call_1', name: 'shell', input: { command: ['ls'] }, output: 'a.txt\nb.txt', isError: false, atMs: null },
    { kind: 'tool', id: 'call_2', name: 'shell', input: { command: ['cat', 'x'] }, output: 'no existe', isError: true, atMs: null },
    { kind: 'assistant', text: 'Hay dos ficheros.', atMs: null },
  ],
};
const CLOCK = { baseMs: Date.parse('2026-10-07T10:00:00Z') };
const ids = (): (() => string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
};
const meta = { cwd: CONVERSATION.cwd, title: CONVERSATION.title };
const withoutTimes = (c: NeutralConversation): unknown => c.items.map((item) => ({ ...item, atMs: null }));

describe('claudeTranscriptText', () => {
  const lines = claudeTranscriptText(CONVERSATION, { sessionId: 's1', newId: ids(), clock: CLOCK }).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

  it('claudeTranscriptText_conversacion_encadenaLasLineasPorParentUuid', () => {
    expect(lines[0]!.parentUuid).toBeNull();
    for (let i = 1; i < lines.length; i += 1) expect(lines[i]!.parentUuid).toBe(lines[i - 1]!.uuid);
    expect(lines.every((l) => l.sessionId === 's1' && l.cwd === 'C:\\proyecto')).toBe(true);
  });

  it('claudeTranscriptText_idaYVuelta_recuperaLaMismaConversacion', () => {
    expect(withoutTimes(neutralFromLines(lines, meta))).toEqual(withoutTimes(CONVERSATION));
  });

  it('claudeTranscriptText_marcasDeTiempo_respetaLasSuyasYAvanzaUnSegundo', () => {
    expect(lines[0]!.timestamp).toBe('2026-10-05T08:00:00.000Z');
    expect(Date.parse(String(lines[1]!.timestamp))).toBeGreaterThan(Date.parse(String(lines[0]!.timestamp)));
  });
});

describe('codexRolloutText', () => {
  const lines = codexRolloutText(CONVERSATION, { threadId: 'hilo-1', clock: CLOCK }).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

  it('codexRolloutText_conversacion_abreConSessionMetaConElIdYElCwd', () => {
    expect(lines[0]).toMatchObject({ type: 'session_meta', payload: { id: 'hilo-1', cwd: 'C:\\proyecto' } });
  });

  it('codexRolloutText_idaYVuelta_recuperaLaConversacionSalvoElMarcadoDeError', () => {
    const back = neutralFromLines(lines.map((l) => adaptCodexLine(l)), meta);

    expect(back.items.map((i) => i.kind)).toEqual(['user', 'tool', 'tool', 'assistant']);
    expect(back.items[1]).toMatchObject({ id: 'call_1', name: 'shell', input: { command: ['ls'] }, output: 'a.txt\nb.txt' });
    expect(back.items[2]).toMatchObject({ output: 'Error: no existe' });
  });

  it('codexRolloutRelativePath_fechaUtc_carpetasPorDiaYNombreConElId', () => {
    expect(codexRolloutRelativePath('abc', Date.parse('2026-10-07T09:05:03Z'))).toEqual(['sessions', '2026', '10', '07', 'rollout-2026-10-07T09-05-03-abc.jsonl']);
  });
});

describe('agyDbContent', () => {
  const content = agyDbContent(CONVERSATION, { conversationId: 'conv-1', trajectoryId: 'traj-1', newId: ids(), clock: CLOCK });

  it('agyDbContent_conversacion_unPasoPorMensajeYLasHerramientasComoTexto', () => {
    expect(content.steps.map((s) => s.stepType)).toEqual([14, 15, 15, 15]);
    expect(content.steps.map((s) => s.idx)).toEqual([0, 1, 2, 3]);
  });

  it('agyDbContent_idaYVuelta_loLeeElLectorDeAgyConLasHerramientasEnElTexto', () => {
    const lines = agyStepsToLines(content.steps.map((s) => ({ index: s.idx, stepType: s.stepType, payload: s.payload })));
    const back = neutralFromLines(lines, meta);

    expect(back.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'assistant', 'assistant']);
    expect(back.items[0]).toMatchObject({ text: 'Recuerda CIRUELA y lista los ficheros' });
    expect(back.items[1]).toMatchObject({ text: expect.stringContaining('[herramienta shell: {"command":["ls"]} → a.txt') });
    expect(back.items[2]).toMatchObject({ text: expect.stringContaining('(con error)') });
  });

  it('agyDbContent_ids_usaLosDeLaConversacionEnMetadatosYBlob', () => {
    const asText = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

    expect(asText(content.steps[0]!.metadata)).toContain('traj-1');
    expect(asText(content.steps[0]!.metadata)).toContain('conv-1');
    expect(asText(content.metadataBlob)).toContain('conv-1');
    expect(asText(content.metadataBlob)).toContain('file:///C:/proyecto');
  });
});
