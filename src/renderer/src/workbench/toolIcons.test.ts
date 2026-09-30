import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from './components/Icon';
import { iconForTool } from './toolIcons';

describe('iconForTool', () => {
  it('iconForTool_herramientaConocida_usaSuIconoPropio', () => {
    expect(iconForTool('Glob')).toBe('toolGlob');
    expect(iconForTool('WebFetch')).toBe('toolWebFetch');
    expect(iconForTool(' Write ')).toBe('toolWrite');
  });

  it('iconForTool_herramientaMcp_usaToolMcp', () => {
    expect(iconForTool('mcp__github__create_issue')).toBe('toolMcp');
  });

  it('iconForTool_herramientaDeClaseSinIconoPropio_caeAlDeLaClase', () => {
    expect(iconForTool('NotebookRead')).toBe('toolRead');
  });

  it('iconForTool_desconocidaOVacia_caeAToolGeneric', () => {
    expect(iconForTool('Inventada')).toBe('toolGeneric');
    expect(iconForTool('')).toBe('toolGeneric');
  });

  it('iconForTool_todoLoQueDevuelve_existeEnLaSuite', () => {
    for (const n of ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch', 'Agent', 'TodoWrite', 'AskUserQuestion', 'mcp__x__y', 'zzz']) {
      expect(Object.keys(ICON_PATHS)).toContain(iconForTool(n));
    }
  });
});
