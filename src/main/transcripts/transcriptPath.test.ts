import { describe, expect, it } from 'vitest';
import { encodeProjectFolderName, resolveSubagentTranscriptPath, resolveTranscriptPath } from './transcriptPath';

describe('encodeProjectFolderName', () => {
  it('cwdRealConDosPuntosBarrasYPunto_generaCarpetaObservadaEnDisco', () => {
    // Ejemplo real verificado: ~/.claude/projects/C--sourcecode-itb-sysMonitor/*.jsonl con
    // cwd:"C:\\sourcecode\\itb.sysMonitor" en las lineas del propio archivo.
    expect(encodeProjectFolderName('C:\\sourcecode\\itb.sysMonitor')).toBe('C--sourcecode-itb-sysMonitor');
  });

  it('cwdSinCaracteresEspeciales_soloBarrasSeSustituyen', () => {
    expect(encodeProjectFolderName('C:\\sourcecode\\mage')).toBe('C--sourcecode-mage');
  });

  it('cwdVacio_lanza', () => {
    expect(() => encodeProjectFolderName('')).toThrow();
  });
});

describe('resolveTranscriptPath', () => {
  it('accountDirCwdYSessionIdValidos_construyeRutaBajoProjects', () => {
    const path = resolveTranscriptPath('C:\\Users\\usuario\\.claude', 'C:\\sourcecode\\mage', 'abc-123');

    expect(path.replace(/\\/g, '/')).toBe('C:/Users/usuario/.claude/projects/C--sourcecode-mage/abc-123.jsonl');
  });

  it('sessionIdVacio_lanza', () => {
    expect(() => resolveTranscriptPath('C:\\Users\\usuario\\.claude', 'C:\\sourcecode\\mage', '')).toThrow();
  });
});

describe('resolveSubagentTranscriptPath', () => {
  it('parametrosValidos_construyeRutaBajoSubagentsDeLaSesion', () => {
    const path = resolveSubagentTranscriptPath(
      'C:\\Users\\usuario\\.claude',
      'C:\\sourcecode\\mage',
      '35d848a2-9087-426b-89b0-a15ff6ade8a0',
      'a39367e193fa0adda',
    );

    expect(path.replace(/\\/g, '/')).toBe(
      'C:/Users/usuario/.claude/projects/C--sourcecode-mage/35d848a2-9087-426b-89b0-a15ff6ade8a0/subagents/agent-a39367e193fa0adda.jsonl',
    );
  });

  it('agentIdConTraversal_lanza', () => {
    // El agentId pasa a ser el NOMBRE del fichero: un `..`/separador escaparia del dir de la cuenta.
    expect(() =>
      resolveSubagentTranscriptPath('C:\\Users\\x\\.claude', 'C:\\p', 'sess-1', '../../../../etc/passwd'),
    ).toThrow();
  });

  it('sessionIdConSeparador_lanza', () => {
    // El sessionId pasa a ser CARPETA: tambien debe rechazar separadores/traversal.
    expect(() =>
      resolveSubagentTranscriptPath('C:\\Users\\x\\.claude', 'C:\\p', '../evil', 'abc123'),
    ).toThrow();
  });

  it('agentIdVacio_lanza', () => {
    expect(() => resolveSubagentTranscriptPath('C:\\Users\\x\\.claude', 'C:\\p', 'sess-1', '')).toThrow();
  });
});
