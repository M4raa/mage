import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pickProcessTree, seedPerfHistory, summarizeLag, summarizeRenderer } from './perfReview.mjs';

describe('perfReview', () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('summarizeLag_muestras_cuentaLasDeMasDe50YDe120', () => {
    const samples = [1, 2, 60, 130, 3];

    const result = summarizeLag(samples);

    expect(result).toMatchObject({ n: 5, maxMs: 130, sobre50Ms: 2, sobre120Ms: 1 });
  });

  it('summarizeLag_sinMuestras_null', () => {
    expect(summarizeLag([])).toBeNull();
  });

  it('summarizeRenderer_sinTareasLargas_ceroYResumenDeFrames', () => {
    const result = summarizeRenderer({ longTasks: [], frames: [16, 17, 60] });

    expect(result).toMatchObject({ tareasLargas: 0, peorTareaMs: 0, framesSobre50Ms: 1, frames: { n: 3, maxMs: 60 } });
  });

  it('pickProcessTree_mainConPerfilYSusHijos_soloEsosConSuTipo', () => {
    const raw = [
      { ProcessId: 10, ParentProcessId: 1, CommandLine: 'electron.exe . --user-data-dir=C:\\perfil\\a', WorkingSetSize: 2 * 1024 * 1024, PageFileUsage: 1024 },
      { ProcessId: 11, ParentProcessId: 10, CommandLine: 'electron.exe --type=renderer', WorkingSetSize: 1024 * 1024, PageFileUsage: 2048 },
      { ProcessId: 20, ParentProcessId: 1, CommandLine: 'electron.exe . --user-data-dir=C:\\otro', WorkingSetSize: 1, PageFileUsage: 1 },
    ];

    const result = pickProcessTree(raw, 'C:\\perfil\\a');

    expect(result).toEqual([
      { pid: 10, tipo: 'main', workingSetMb: 2, privadaMb: 1 },
      { pid: 11, tipo: 'renderer', workingSetMb: 1, privadaMb: 2 },
    ]);
  });

  it('pickProcessTree_sinMainDelPerfil_lanza', () => {
    expect(() => pickProcessTree([], 'C:\\perfil\\a')).toThrow('Ningún electron.exe principal');
  });

  it('seedPerfHistory_dosConversaciones_asistenteConMessageIdYBytes', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-perf-seed-'));
    dirs.push(home);
    const seeded = seedPerfHistory(path.join(home, '.claude'), { conversations: 2, blocks: 4, nowMs: Date.UTC(2026, 10, 15) });

    const lines = fs.readFileSync(seeded.files[0], 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(seeded.files).toHaveLength(2);
    expect(lines.filter((line) => line.type === 'assistant').every((line) => typeof line.message.id === 'string')).toBe(true);
    expect(seeded.bytes).toBeGreaterThan(0);
  });
});
