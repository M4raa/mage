import { describe, expect, it } from 'vitest';
import { buildLongTranscript, encodeProjectFolderName as fixtureEncode } from './longTranscriptFixture.mjs';
import { encodeProjectFolderName } from '../../src/main/transcripts/transcriptPath';
import { parseTranscriptLine } from '../../src/main/transcripts/normalize';
import { TranscriptAssistantLineSchema, TranscriptUserLineSchema } from '../../src/main/transcripts/schemas';
import { transcriptToBlocks } from '../../src/renderer/src/workbench/transcriptToBlocks';

const SESSION_ID = '7e570000-0000-4000-8000-000000000003';
const START_MS = Date.UTC(2026, 10, 1);

function build(blocks) {
  return buildLongTranscript({ sessionId: SESSION_ID, cwd: '/tmp/vg', blocks, startMs: START_MS });
}

describe('longTranscriptFixture', () => {
  it('encodeProjectFolderName_sameAsMain_forWindowsAndPosixPaths', () => {
    for (const cwd of ['C:\sourcecode\itb.sysMonitor', '/home/u/a b']) {
      expect(fixtureEncode(cwd)).toBe(encodeProjectFolderName(cwd));
    }
  });

  it('buildLongTranscript_3000_parsesToThousandsOfBlocks', () => {
    const lines = build(3000);
    const raws = lines.map((line) => JSON.parse(line));
    raws.forEach((raw) => {
      const schema = raw.type === 'user' ? TranscriptUserLineSchema : TranscriptAssistantLineSchema;
      expect(schema.safeParse(raw).success).toBe(true);
    });
    const entries = raws.map((raw, index) => {
      const parsed = parseTranscriptLine(raw, index + 1);
      if (!parsed.ok) throw new Error(`linea ${index + 1} no parsea: ${parsed.error}`);
      return parsed.entry;
    });
    const blocks = transcriptToBlocks(entries);
    expect(lines).toHaveLength(3000);
    expect(blocks).toHaveLength(3000);
    expect(blocks[0]).toMatchObject({ kind: 'user', text: 'VG-T3 · conversación de 3000 bloques' });
  });

  it('buildLongTranscript_oddOrZero_throwsWithValue', () => {
    expect(() => build(0)).toThrow('0');
    expect(() => build(3)).toThrow('3');
  });
});
