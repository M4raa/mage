import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './registry';
import { createGlobTool, createGrepTool, createReadTool, type ReadToolsDeps } from './readTools';
import { toJsonSchema, truncateOutput, type RuntimeTool } from './types';

const fakeFs = {} as ReadToolsDeps['fs'];
const READ_TOOLS = [createReadTool({ fs: fakeFs, platform: 'linux' }), createGlobTool({ fs: fakeFs, platform: 'linux' }), createGrepTool({ fs: fakeFs, platform: 'linux' })];

function registry(tools: readonly RuntimeTool[] = READ_TOOLS as unknown as RuntimeTool[]): ToolRegistry {
  return new ToolRegistry(tools, (signal) => ({ cwd: '/p', extraDirs: [], signal }));
}

describe('ToolRegistry.prepare', () => {
  it('prepare_truncatedJson_errorWithRawArgs', () => {
    const result = registry().prepare('Read', '{"file_path": "hola.txt"');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/no son JSON válido.*Recibido: \{"file_path": "hola.txt"/);
  });

  it('prepare_unknownTool_listsAvailable', () => {
    const result = registry().prepare('leer', '{}');

    expect(!result.ok && result.error).toBe('Error: la herramienta "leer" no existe. Disponibles: Read, Glob, Grep');
  });

  it('prepare_missingRequiredField_saysWhich', () => {
    const result = registry().prepare('Glob', '{}');

    expect(!result.ok && result.error).toMatch(/pattern/);
  });

  it('prepare_emptyArgsString_treatedAsEmptyObject', () => {
    const result = registry().prepare('Glob', '');

    expect(!result.ok && result.error).toMatch(/argumentos inválidos/);
  });

  it('prepare_arrayArgs_rejected', () => {
    expect(registry().prepare('Glob', '[]').ok).toBe(false);
  });

  it('prepare_valid_returnsKindAndInput', () => {
    expect(registry().prepare('Read', '{"file_path":"a","offset":"2"}')).toEqual({ ok: true, kind: 'read', input: { file_path: 'a', offset: 2 } });
  });

  it('constructor_duplicateName_throws', () => {
    expect(() => registry([...(READ_TOOLS as unknown as RuntimeTool[]), READ_TOOLS[0] as unknown as RuntimeTool])).toThrow(/Read/);
  });
});

describe('ToolRegistry.run', () => {
  it('run_toolThrows_becomesErrorResult', async () => {
    const boom: RuntimeTool = {
      name: 'Boom',
      kind: 'read',
      description: '',
      fields: {},
      input: z.object({}),
      run: () => Promise.reject(new Error('EACCES')),
    };

    const out = await registry([boom]).run('Boom', {}, new AbortController().signal);

    expect(out).toEqual({ isError: true, output: 'Error ejecutando Boom: EACCES' });
  });
});

describe('toJsonSchema', () => {
  // El esquema que ve el modelo tiene que aceptar lo mismo que el Zod que valida: los requeridos de uno
  // son los obligatorios del otro, y todo campo del esquema lo conoce el Zod.
  it('schema_eachTool_matchesItsZod', () => {
    for (const tool of READ_TOOLS as unknown as RuntimeTool[]) {
      const schema = toJsonSchema(tool.fields) as { properties: Record<string, { type: string }>; required: string[] };
      const sample: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (schema.required.includes(name)) sample[name] = prop.type === 'string' ? 'x' : prop.type === 'number' ? 1 : true;
      }
      expect(tool.input.safeParse(sample).success, tool.name).toBe(true);
      for (const name of schema.required) {
        const { [name]: _dropped, ...rest } = sample;
        expect(tool.input.safeParse(rest).success, `${tool.name} sin ${name}`).toBe(false);
      }
    }
  });
});

describe('truncateOutput', () => {
  it('truncate_long_keepsHeadAndTailWithMarker', () => {
    const out = truncateOutput('a'.repeat(60) + 'b'.repeat(40), 10);

    expect(out).toBe('aaaaaa\n[… 90 caracteres omitidos …]\nbbbb');
  });

  it('truncate_short_untouched', () => {
    expect(truncateOutput('hola', 10)).toBe('hola');
  });

  it('truncate_zeroMax_throws', () => {
    expect(() => truncateOutput('x', 0)).toThrow(/0/);
  });
});
