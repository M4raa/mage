import { describe, expect, it } from 'vitest';
import { parseDeliverables, parsePlan } from '@shared/tasks';
import { buildTaskInstructions } from './taskInstructions';

const BASE = { provider: 'claude', language: 'es', folders: ['/w', '/x', '/y'], documents: ['/d/a.pdf'], capabilities: ['Docx'] } as const;

describe('buildTaskInstructions', () => {
  it('buildTaskInstructions_claudeConTodo_contieneSeccionesYCarpetas', () => {
    const text = buildTaskInstructions(BASE);

    expect(text).toContain('# Mage task mode');
    expect(text).toContain('Working folder: /w');
    expect(text).toContain('Other folders you may read and write:\n- /x\n- /y');
    expect(text).toContain('## Authorized documents (read-only inputs)\n- /d/a.pdf');
    expect(text).toContain('## Capabilities the user selected\n- Docx');
    expect(text).toContain('## Plan');
    expect(text).toContain('## Deliverables');
  });

  it('buildTaskInstructions_codex_extrasSoloLectura', () => {
    const text = buildTaskInstructions({ ...BASE, provider: 'codex' });

    expect(text).toContain('Other folders you may read (your sandbox only lets you write in the working folder):\n- /x');
    expect(text).not.toContain('read and write');
  });

  it('buildTaskInstructions_sinDocumentosNiCapacidades_omiteSecciones', () => {
    const text = buildTaskInstructions({ ...BASE, folders: ['/w'], documents: [], capabilities: [] });

    expect(text).not.toContain('Authorized documents');
    expect(text).not.toContain('Capabilities the user selected');
    expect(text).not.toContain('Other folders');
    expect(text).toContain('Working folder: /w\nNever create');
  });

  it('buildTaskInstructions_ingles_dicesEnglish', () => {
    expect(buildTaskInstructions({ ...BASE, language: 'en' })).toContain('in English, the language the user chose.');
    expect(buildTaskInstructions(BASE)).toContain('in Spanish, the language');
  });

  it('buildTaskInstructions_sinCarpetas_lanza', () => {
    expect(() => buildTaskInstructions({ ...BASE, folders: [] })).toThrow('[]');
  });

  it('buildTaskInstructions_valasEntendidasPorElParser_roundTrip', () => {
    const text = buildTaskInstructions(BASE);

    expect(text).toContain('`'.repeat(3) + 'mage-plan');
    expect(text).toContain('`'.repeat(3) + 'mage-deliverables');
    expect(parseDeliverables(text)).toEqual(['report.md']);
    expect(parsePlan(text)).toEqual([
      { text: 'first step', done: false },
      { text: 'finished step', done: true },
    ]);
  });
});
