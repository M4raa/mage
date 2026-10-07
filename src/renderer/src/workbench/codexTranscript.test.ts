import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptCodexLine } from '@shared/codexTranscript';
import type { TranscriptEntry } from '@shared/transcripts';
import { transcriptToBlocks } from './transcriptToBlocks';

const lines = readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'codex-rollout.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.length > 0);

// Entrada mínima con lo que lee transcriptToBlocks (la normalización real vive en main).
function entryOf(line: string, index: number): TranscriptEntry {
  const raw = adaptCodexLine(JSON.parse(line)) as Record<string, unknown>;
  return {
    index,
    uuid: null,
    parentUuid: null,
    isSidechain: false,
    isMeta: raw.isMeta === true,
    timestampMs: null,
    category: raw.type === 'user' || raw.type === 'assistant' ? 'turn' : 'metadata',
    kind: String(raw.type),
    summary: '',
    tokenUsage: null,
    raw,
  };
}

describe('transcriptToBlocks con un rollout de Codex', () => {
  it('rolloutCompleto_dibujaUsuarioHerramientasYRespuesta', () => {
    const blocks = transcriptToBlocks(lines.map(entryOf));

    expect(blocks.map((b) => b.kind)).toEqual(['user', 'tool', 'tool', 'agent']);
  });
});
