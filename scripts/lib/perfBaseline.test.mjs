import { describe, expect, it } from 'vitest';
import { summarize, topSelfTime } from './perfBaseline.mjs';

describe('perfBaseline (#40)', () => {
  it('summarize_muestras_medianaP90YMaximo', () => {
    const samples = Array.from({ length: 10 }, (_, i) => i + 1);

    expect(summarize(samples)).toEqual({ n: 10, medianaMs: 6, p90Ms: 10, maxMs: 10 });
  });

  it('summarize_unaMuestra_todoIgual', () => {
    expect(summarize([4.26])).toEqual({ n: 1, medianaMs: 4.3, p90Ms: 4.3, maxMs: 4.3 });
  });

  it('summarize_sinMuestras_lanza', () => {
    expect(() => summarize([])).toThrow('Sin muestras');
  });

  it('topSelfTime_perfil_sumaTiempoPropioPorFuncionSinIdle', () => {
    const frame = (functionName, url = 'http://localhost/src/renderer/a.ts?t=1', lineNumber = 9) => ({ functionName, url, lineNumber });
    const profile = {
      nodes: [{ id: 1, callFrame: frame('(idle)', '') }, { id: 2, callFrame: frame('render') }, { id: 3, callFrame: frame('') }],
      samples: [1, 2, 2, 3],
      timeDeltas: [5000, 1000, 2000, 500],
    };

    expect(topSelfTime(profile)).toEqual([
      { fn: 'render · src/renderer/a.ts:10', selfMs: 3 },
      { fn: '(anónima) · src/renderer/a.ts:10', selfMs: 0.5 },
    ]);
  });

  it('topSelfTime_funcionDelSidebarFueraDelTop_seConserva', () => {
    const frame = (functionName, url) => ({ functionName, url, lineNumber: 0 });
    const profile = {
      nodes: [{ id: 1, callFrame: frame('caro', 'http://localhost/src/a.ts') }, { id: 2, callFrame: frame('HistoryItem', 'http://localhost/src/workbench/components/ChatSidebar.tsx') }, { id: 3, callFrame: frame('otro', 'http://localhost/src/b.ts') }],
      samples: [1, 1, 3, 2],
      timeDeltas: [1000, 1000, 500, 100],
    };

    expect(topSelfTime(profile, 1).map((e) => e.fn)).toEqual(['caro · src/a.ts:1', 'HistoryItem · src/workbench/components/ChatSidebar.tsx:1']);
  });
});
