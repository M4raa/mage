import { describe, expect, it } from 'vitest';
import { classifyTool, TOOL_CLASS_ICON } from './toolClassify';

describe('classifyTool', () => {
  it('classifyTool_read_devuelveRead', () => {
    expect(classifyTool('Read')).toBe('read');
    expect(classifyTool('NotebookRead')).toBe('read');
  });

  it('classifyTool_grep_devuelveSearch', () => {
    expect(classifyTool('Grep')).toBe('search');
    expect(classifyTool('Glob')).toBe('search');
    expect(classifyTool('WebFetch')).toBe('search');
  });

  it('classifyTool_edit_devuelveEdit', () => {
    expect(classifyTool('Edit')).toBe('edit');
    expect(classifyTool('Write')).toBe('edit');
    expect(classifyTool('MultiEdit')).toBe('edit');
  });

  it('classifyTool_bash_devuelveCommand', () => {
    expect(classifyTool('Bash')).toBe('command');
    expect(classifyTool('KillShell')).toBe('command');
  });

  it('classifyTool_task_devuelveSubagent', () => {
    expect(classifyTool('Task')).toBe('subagent');
    expect(classifyTool('Agent')).toBe('subagent');
  });

  it('classifyTool_mcpConPrefijo_devuelveOther', () => {
    expect(classifyTool('mcp__database__run_query')).toBe('other');
  });

  it('classifyTool_toolDesconocida_devuelveOther', () => {
    expect(classifyTool('ToolDelFuturo')).toBe('other');
  });

  it('classifyTool_cadenaVacia_devuelveOther', () => {
    expect(classifyTool('')).toBe('other');
    expect(classifyTool('   ')).toBe('other');
  });

  it('classifyTool_conEspacios_seRecorta', () => {
    expect(classifyTool(' Read ')).toBe('read');
  });
});

describe('TOOL_CLASS_ICON', () => {
  it('TOOL_CLASS_ICON_tieneIconoParaTodasLasClases', () => {
    for (const toolClass of ['read', 'search', 'edit', 'command', 'subagent', 'other'] as const) {
      expect(TOOL_CLASS_ICON[toolClass].startsWith('tool')).toBe(true);
    }
  });
});
