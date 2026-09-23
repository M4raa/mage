import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHandoffPrompt, buildImprovePrompt } from './promptText';
import { PromptService, type PromptServiceDeps } from './promptService';

describe('buildImprovePrompt', () => {
  it('borradorVacio_lanza', () => {
    expect(() => buildImprovePrompt('   ')).toThrow(/vacio/i);
  });

  it('borradorValido_incluyeElTextoYPideSoloElPromptMejorado', () => {
    const out = buildImprovePrompt('arregla el bug');

    expect(out).toContain('arregla el bug');
    expect(out).toContain('UNICAMENTE');
  });
});

describe('PromptService.improve', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-remove';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  function build(run: PromptServiceDeps['run']): PromptService {
    return new PromptService({ resolveBinary: () => 'claude', run });
  }

  it('invoca_conModeloBaratoYSinApiKeyEnElHijo', async () => {
    const run = vi.fn(async () => 'prompt mejorado');
    const service = build(run);

    const result = await service.improve('hazlo mejor', '/home/u/.claude-p');

    expect(result).toBe('prompt mejorado');
    const [command, args, env] = run.mock.calls[0] as unknown as [string, readonly string[], NodeJS.ProcessEnv];
    expect(command).toBe('claude');
    expect(args).toContain('-p');
    expect(args.join(' ')).toContain('--model haiku');
    expect('ANTHROPIC_API_KEY' in env).toBe(false);
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/u/.claude-p');
  });

  it('recortaElStdout', async () => {
    const result = await build(async () => '  mejorado \n').improve('x', '/acc');

    expect(result).toBe('mejorado');
  });

  it('accountDirVacio_lanza', async () => {
    await expect(build(async () => 'x').improve('draft', '  ')).rejects.toThrow(/accountDir/i);
  });

  it('stdoutVacio_lanza', async () => {
    await expect(build(async () => '   ').improve('draft', '/acc')).rejects.toThrow(/vacia/i);
  });
});

describe('buildHandoffPrompt', () => {
  it('pideUnPromptAutocontenidoParaUnChatNuevo', () => {
    const out = buildHandoffPrompt();

    expect(out).toContain('HANDOFF');
    expect(out).toContain('UNICAMENTE');
  });
});

describe('PromptService.handoff', () => {
  function build(run: PromptServiceDeps['run']): PromptService {
    return new PromptService({ resolveBinary: () => 'claude', run });
  }

  const request = { sessionId: 'sess-1', accountDir: '/home/u/.claude', model: 'opus', cwd: '/proj' };

  it('invoca_conResumeDeLaSesionYModelo', async () => {
    const run = vi.fn(async () => 'prompt de handoff');
    const result = await build(run).handoff(request);

    expect(result).toBe('prompt de handoff');
    const [command, args, env] = run.mock.calls[0] as unknown as [string, readonly string[], NodeJS.ProcessEnv];
    expect(command).toBe('claude');
    expect(args.join(' ')).toContain('--resume sess-1');
    expect(args.join(' ')).toContain('--model opus');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/u/.claude');
  });

  it('lanzaElHijoEnElCwdDeLaConversacion_paraQueResumeLaEncuentre', async () => {
    const run = vi.fn(async () => 'ok');
    await build(run).handoff(request);

    const [, , , cwd] = run.mock.calls[0] as unknown as [string, readonly string[], NodeJS.ProcessEnv, string];
    expect(cwd).toBe('/proj');
  });

  it('nuncaPasaLaApiKeyAlHijo', async () => {
    const run = vi.fn(async () => 'ok');
    await build(run).handoff(request);

    const [, , env] = run.mock.calls[0] as unknown as [string, readonly string[], NodeJS.ProcessEnv];
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('sessionIdVacio_lanza', async () => {
    await expect(build(async () => 'x').handoff({ ...request, sessionId: '  ' })).rejects.toThrow(/sessionId/i);
  });

  it('cwdVacio_lanza', async () => {
    await expect(build(async () => 'x').handoff({ ...request, cwd: '' })).rejects.toThrow(/cwd/i);
  });

  it('accountDirVacio_lanza', async () => {
    await expect(build(async () => 'x').handoff({ ...request, accountDir: ' ' })).rejects.toThrow(/accountDir/i);
  });

  it('stdoutVacio_lanza', async () => {
    await expect(build(async () => '  ').handoff(request)).rejects.toThrow(/vacia/i);
  });
});
