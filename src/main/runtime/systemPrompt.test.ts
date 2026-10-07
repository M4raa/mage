import { expect, it } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';

it('incluyeLasReglasDelProyectoEnElPromptDeSistemaDelRuntime', () => {
  const prompt = buildSystemPrompt({ cwd: '/app', platform: 'linux', shellName: null, nowIso: '2026-10-07T00:00:00Z', toolNames: [], projectNotes: null, projectInstructions: 'Eres experto en Python' });
  expect(prompt).toContain('Mage project instructions:\nEres experto en Python');
});
