import { describe, expect, it } from 'vitest';
import { CanUseToolSchema, InitializeResponseSchema } from './schemas';

// Esquemas del protocolo EN VIVO (distinto del persistido, ver la cabecera de schemas.ts). Lo que se
// prueba aqui es la TOLERANCIA: el CLI añade campos entre versiones y eso no puede tumbar a Mage.

const CAN_USE_TOOL = {
  type: 'control_request',
  request_id: 'r1',
  request: { subtype: 'can_use_tool', tool_name: 'Write', input: { path: 'a.txt' }, tool_use_id: 'u1' },
};

describe('CanUseToolSchema', () => {
  it('CanUseToolSchema_conRequiresUserInteraction_loParsea', () => {
    // Forma MEDIDA del control_request de AskUserQuestion (2.3).
    const raw = {
      ...CAN_USE_TOOL,
      request: {
        ...CAN_USE_TOOL.request,
        tool_name: 'AskUserQuestion',
        display_name: 'AskUserQuestion',
        requires_user_interaction: true,
      },
    };

    const result = CanUseToolSchema.safeParse(raw);

    expect(result.success).toBe(true);
    expect(result.data?.request.requires_user_interaction).toBe(true);
    expect(result.data?.request.display_name).toBe('AskUserQuestion');
  });

  it('CanUseToolSchema_sinEsosCampos_parseaIgual', () => {
    const result = CanUseToolSchema.safeParse(CAN_USE_TOOL);

    expect(result.success).toBe(true);
    expect(result.data?.request.requires_user_interaction).toBeUndefined();
  });

  it('CanUseToolSchema_campoNuevoDesconocido_noInvalida', () => {
    const raw = { ...CAN_USE_TOOL, request: { ...CAN_USE_TOOL.request, campo_del_futuro: 42 } };

    expect(CanUseToolSchema.safeParse(raw).success).toBe(true);
  });
});

describe('InitializeResponseSchema', () => {
  it('InitializeResponseSchema_conAgents_losParsea', () => {
    const raw = {
      commands: [{ name: 'compact', description: 'Compacta' }],
      agents: [{ name: 'Explore', description: 'Busca en el repo', model: 'haiku' }],
    };

    const result = InitializeResponseSchema.parse(raw);

    expect(result.agents).toEqual([{ name: 'Explore', description: 'Busca en el repo', model: 'haiku' }]);
  });

  it('InitializeResponseSchema_agentsConFormaRara_caeAVacioSinInvalidarCommands', () => {
    // El `.catch([])` es lo que impide que un campo nuevo del CLI tumbe el catalogo entero de comandos,
    // que es lo unico que Mage necesita de verdad de esta respuesta.
    const result = InitializeResponseSchema.parse({ commands: [{ name: 'compact' }], agents: 'ninguno' });

    expect(result.agents).toEqual([]);
    expect(result.commands).toHaveLength(1);
  });

  it('InitializeResponseSchema_sinAgents_caeAVacio', () => {
    expect(InitializeResponseSchema.parse({ commands: [] }).agents).toEqual([]);
  });

  it('InitializeResponseSchema_comandoConAliases_losParsea', () => {
    const raw = { commands: [{ name: 'compact', description: 'Compacta', argumentHint: '[foco]', aliases: ['c'] }] };

    const parsed = InitializeResponseSchema.parse(raw).commands[0];

    expect(parsed?.aliases).toEqual(['c']);
    expect(parsed?.argumentHint).toBe('[foco]');
  });

  it('InitializeResponseSchema_comandosConFormaRara_caenAVacio', () => {
    expect(InitializeResponseSchema.parse({ commands: 'nada' }).commands).toEqual([]);
  });
});
