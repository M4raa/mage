import { describe, expect, it, vi } from 'vitest';
import { createMessages } from './messages.mjs';
import { resolveTarget } from './targetPicker.mjs';

const messages = createMessages('es');
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

function setup({ target, responses = {}, answers = [] }) {
  const rpc = { call: vi.fn(async (method) => {
    const response = responses[method];
    if (response instanceof Error) throw response;
    return response;
  }) };
  const queue = [...answers];
  const output = [];
  const ask = vi.fn(async () => queue.shift());
  const run = () => resolveTarget({ rpc, target, cwd: '/proyecto', ask, write: (text) => output.push(text), messages, newCommandId: () => COMMAND_ID });
  return { rpc, run, ask, output };
}

const ACCOUNTS = { accounts: [
  { id: 'a-agy', name: 'Gemini', provider: 'agy', billing: 'subscription' },
  { id: 'a-claude', name: 'Personal', provider: 'claude', billing: 'subscription' },
] };

describe('resolveTarget', () => {
  it('resolveTarget_session_devuelveElId', async () => {
    const { run, rpc } = setup({ target: { kind: 'session', sessionId: 's9' } });

    expect(await run()).toBe('s9');
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('resolveTarget_conversation_usaResume', async () => {
    const { run, rpc } = setup({ target: { kind: 'conversation', conversationId: 'c1' }, responses: { 'session.resume': { sessionId: 's2' } } });

    expect(await run()).toBe('s2');
    expect(rpc.call).toHaveBeenCalledWith('session.resume', { conversationId: 'c1' });
  });

  it('resolveTarget_new_creaConTrustNoReconocido', async () => {
    const target = { kind: 'new', accountId: 'a1', provider: 'codex', cwd: null, model: 'm', effort: 'low' };
    const { run, rpc } = setup({ target, responses: { 'accounts.list': { accounts: [] }, 'session.create': { sessionId: 's3' } } });

    expect(await run()).toBe('s3');
    expect(rpc.call).toHaveBeenCalledWith('session.create', {
      commandId: COMMAND_ID, provider: 'codex', accountId: 'a1', cwd: '/proyecto', trust: { acknowledged: false }, model: 'm', effort: 'low',
    });
  });

  it('resolveTarget_new_trustRequired_exitCode3', async () => {
    const refused = Object.assign(new Error('Carpeta sin confianza'), { code: -32007 });
    const { run } = setup({ target: { kind: 'new', accountId: 'a', provider: 'claude', cwd: '/x' }, responses: { 'accounts.list': { accounts: [] }, 'session.create': refused } });

    await expect(run()).rejects.toMatchObject({ message: 'Carpeta sin confianza', exitCode: 3 });
  });

  it('resolveTarget_new_bypassBloqueado_exitCode4ConElMensajeDelHost', async () => {
    const refused = Object.assign(new Error('El host de Mage no acepta…'), { code: -32011 });
    const { run } = setup({ target: { kind: 'new', accountId: 'a', provider: 'claude', cwd: '/x', permissionMode: 'bypassPermissions' }, responses: { 'accounts.list': { accounts: [] }, 'session.create': refused } });

    await expect(run()).rejects.toMatchObject({ message: 'El host de Mage no acepta…', exitCode: 4 });
  });

  describe('--account por nombre', () => {
    const NAMED = { accounts: [
      { id: '/h/.claude-a', provider: 'claude', name: 'trabajo', billing: 'api' },
      { id: '/h/.claude-b', provider: 'claude', name: 'casa', billing: 'subscription' },
      { id: '/h/.claude-c', provider: 'claude', name: 'casa', billing: 'api' },
      { id: '/h/.codex-a', provider: 'codex', name: 'trabajo', billing: 'api' },
    ] };
    const created = (accountId, provider = 'claude') => setup({
      target: { kind: 'new', accountId, provider, cwd: null },
      responses: { 'accounts.list': NAMED, 'session.create': { sessionId: 's7' } },
    });
    const createdWith = (rpc) => rpc.call.mock.calls.find(([method]) => method === 'session.create')?.[1].accountId;

    it('resolveTarget_newConNombreUnico_creaConSuRuta', async () => {
      const { run, rpc } = created('trabajo');

      await run();

      expect(createdWith(rpc)).toBe('/h/.claude-a');
    });

    it('resolveTarget_newConRuta_laPasaTalCual', async () => {
      const { run, rpc } = created('/h/.claude-b');

      await run();

      expect(createdWith(rpc)).toBe('/h/.claude-b');
    });

    it('resolveTarget_newConNombreAmbiguo_salida2ConLasRutas', async () => {
      const { run, rpc } = created('casa');

      await expect(run()).rejects.toMatchObject({ exitCode: 2, message: expect.stringMatching(/\/h\/\.claude-b[\s\S]*\/h\/\.claude-c/) });

      expect(rpc.call).not.toHaveBeenCalledWith('session.create', expect.anything());
    });

    it('resolveTarget_newNombreDeOtroProveedor_noLoToma', async () => {
      const { run, rpc } = created('trabajo', 'codex');

      await run();

      expect(createdWith(rpc)).toBe('/h/.codex-a');
    });

    describe('nombre dado con --name', () => {
      const withAccounts = (accounts, accountId, provider = 'claude') => setup({
        target: { kind: 'new', accountId, provider, cwd: null },
        responses: { 'accounts.list': { accounts }, 'session.create': { sessionId: 's8' } },
      });
      const CPI = { id: 'C:/h/.claude-cpI-api', name: '.claude-cpI-api', provider: 'claude' };

      it('resolveAccountId_nombreSinPrefijo_casa', async () => {
        const { run, rpc } = withAccounts([CPI], 'cpI-api');

        await run();

        expect(createdWith(rpc)).toBe('C:/h/.claude-cpI-api');
      });

      it('resolveAccountId_nombreConPrefijo_casa', async () => {
        const { run, rpc } = withAccounts([CPI], '.claude-cpI-api');

        await run();

        expect(createdWith(rpc)).toBe('C:/h/.claude-cpI-api');
      });

      it('resolveAccountId_dosCasan_errorConLasRutas', async () => {
        const plain = { id: 'C:/h/otra', name: 'cpI-api', provider: 'claude' };
        const { run, rpc } = withAccounts([plain, CPI], 'cpI-api');

        await expect(run()).rejects.toMatchObject({ exitCode: 2, message: expect.stringMatching(/C:\/h\/otra[\s\S]*C:\/h\/\.claude-cpI-api/) });

        expect(rpc.call).not.toHaveBeenCalledWith('session.create', expect.anything());
      });

      it('resolveAccountId_prefijoDeOtroProveedor_noCasa', async () => {
        const codex = { id: 'C:/h/.codex-cpI-api', name: '.codex-cpI-api', provider: 'codex' };
        const { run, rpc } = withAccounts([CPI, codex], 'cpI-api', 'codex');

        await run();

        expect(createdWith(rpc)).toBe('C:/h/.codex-cpI-api');
      });

      it('resolveAccountId_prefijoDeClaudeEnCodex_noCasa', async () => {
        const { run, rpc } = withAccounts([{ ...CPI, provider: 'codex' }], 'cpI-api', 'codex');

        await run();

        expect(createdWith(rpc)).toBe('cpI-api');
      });
    });

    it('resolveTarget_newSinCoincidencia_pasaElTexto', async () => {
      const { run, rpc } = created('nadie');

      await run();

      expect(createdWith(rpc)).toBe('nadie');
    });
  });

  it('resolveTarget_pickConSesiones_eligeLaSegunda', async () => {
    const sessions = [{ sessionId: 's1', provider: 'claude', state: 'idle', conversationId: 'c1' }, { sessionId: 's2', provider: 'codex', state: 'running', conversationId: null }];
    const { run, output } = setup({ target: { kind: 'pick' }, responses: { 'sessions.list': { sessions } }, answers: ['2'] });

    expect(await run()).toBe('s2');
    expect(output.join('')).toContain('  2) codex · running · s2');
  });

  it('resolveTarget_pickN_creaConLaCuentaElegida', async () => {
    const sessions = [{ sessionId: 's1', provider: 'claude', state: 'idle', conversationId: 'c1' }];
    const { run, rpc, output } = setup({
      target: { kind: 'pick' }, answers: ['n', '1'],
      responses: { 'sessions.list': { sessions }, 'accounts.list': ACCOUNTS, 'session.create': { sessionId: 's5' } },
    });

    expect(await run()).toBe('s5');
    expect(output.join('')).not.toContain('Gemini');
    expect(rpc.call).toHaveBeenCalledWith('session.create', expect.objectContaining({ provider: 'claude', accountId: 'a-claude', cwd: '/proyecto' }));
  });

  it('resolveTarget_pickSinSesiones_vaDirectoALasCuentas', async () => {
    const { run } = setup({
      target: { kind: 'pick' }, answers: ['1'],
      responses: { 'sessions.list': { sessions: [] }, 'accounts.list': ACCOUNTS, 'session.create': { sessionId: 's6' } },
    });

    expect(await run()).toBe('s6');
  });

  it('resolveTarget_pickTresRespuestasMalas_exitCode2', async () => {
    const sessions = [{ sessionId: 's1', provider: 'claude', state: 'idle', conversationId: 'c1' }];
    const { run, ask } = setup({ target: { kind: 'pick' }, responses: { 'sessions.list': { sessions } }, answers: ['0', 'x', '9'] });

    await expect(run()).rejects.toMatchObject({ message: expect.stringContaining('9'), exitCode: 2 });
    expect(ask).toHaveBeenCalledTimes(3);
  });
});
