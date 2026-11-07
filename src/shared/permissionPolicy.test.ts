import { describe, expect, it } from 'vitest';
import { automaticAnswer, prTurnBlockReason, touchesPrTurnCommand } from './permissionPolicy';

describe('touchesPrTurnCommand', () => {
  it.each(['git push origin main', 'npm test && git commit -m x', 'git -C repo push', 'gh pr create --fill', 'echo git push'])(
    'touchesPrTurnCommand_%s_true',
    (command) => {
      expect(touchesPrTurnCommand(command)).toBe(true);
    },
  );

  it.each(['git status', 'mkdir a', 'gh pr view 3', ''])('touchesPrTurnCommand_%s_false', (command) => {
    expect(touchesPrTurnCommand(command)).toBe(false);
  });
});

describe('prTurnBlockReason', () => {
  it('prTurnBlockReason_pushNormalYGhPrCreateSimple_null', () => {
    expect(prTurnBlockReason('git push -u origin HEAD')).toBeNull();
    expect(prTurnBlockReason('git add -A && git commit -m "arregla x" && git push')).toBeNull();
    expect(prTurnBlockReason('gh pr create --title "x" --body "y" --draft')).toBeNull();
  });

  it('prTurnBlockReason_pushForzado_bloquea', () => {
    expect(prTurnBlockReason('git push --force origin rama')).toBe('git push --force');
    expect(prTurnBlockReason('git push --force-with-lease')).toBe('git push --force-with-lease');
    expect(prTurnBlockReason('git push -fu origin rama')).toBe('git push -fu');
    expect(prTurnBlockReason('git push origin +rama')).toBe('git push +rama');
    expect(prTurnBlockReason('git -C repo push --no-verify')).toBe('git push --no-verify');
  });

  it('prTurnBlockReason_commitQueSaltaHooksOReescribe_bloquea', () => {
    expect(prTurnBlockReason('git commit --amend --no-edit')).toBe('git commit --amend');
    expect(prTurnBlockReason('git commit -n -m x')).toBe('git commit -n');
    expect(prTurnBlockReason('git commit -F msg.txt')).toBe('git commit -F');
  });

  it('prTurnBlockReason_ghPrCreateEnOtroRepo_bloquea', () => {
    expect(prTurnBlockReason('gh pr create --repo otro/repo --fill')).toBe('gh pr create --repo');
    expect(prTurnBlockReason('cd x; gh pr create -H fork:rama')).toBe('gh pr create -H');
  });

  it('prTurnBlockReason_vacioOComandoAjeno_null', () => {
    expect(prTurnBlockReason('')).toBeNull();
    expect(prTurnBlockReason('pnpm test --force')).toBeNull();
  });
});

// Orden fijo (H1 de la devolución 14): barrera de PR > fuera del proyecto > regla > preguntar.
describe('automaticAnswer', () => {
  const bash = (command: string, outsideProject?: boolean) => ({ toolName: 'Bash', input: { command }, ...(outsideProject === undefined ? {} : { outsideProject }) });

  it('automaticAnswer_reglaBashYBarreraDePr_deniega', () => {
    expect(automaticAnswer({ prGuard: true, alwaysAllowTools: ['Bash'], request: bash('git push --force') })).toEqual({ behavior: 'deny', blocked: 'git push --force' });
  });

  it('automaticAnswer_barreraDePrFueraDelProyecto_deniega', () => {
    expect(automaticAnswer({ prGuard: true, alwaysAllowTools: [], request: bash('git push -f', true) })?.behavior).toBe('deny');
  });

  it('automaticAnswer_barreraConComandoPermitido_aplicaLaRegla', () => {
    expect(automaticAnswer({ prGuard: true, alwaysAllowTools: ['Bash'], request: bash('git push origin rama') })).toEqual({ behavior: 'allow' });
  });

  it('automaticAnswer_reglaFueraDelProyecto_pregunta', () => {
    expect(automaticAnswer({ prGuard: false, alwaysAllowTools: ['Bash'], request: bash('ls', true) })).toBeNull();
  });

  it('automaticAnswer_preguntaConRegla_pregunta', () => {
    const question = { toolName: 'AskUserQuestion', input: { questions: [{ question: '¿Cuál?', header: 'h', options: [{ label: 'a', description: '' }, { label: 'b', description: '' }], multiSelect: false }] } };
    expect(automaticAnswer({ prGuard: false, alwaysAllowTools: ['AskUserQuestion'], request: question })).toBeNull();
  });

  it('automaticAnswer_sinReglaNiBarrera_pregunta', () => {
    expect(automaticAnswer({ prGuard: false, alwaysAllowTools: [], request: bash('git push --force') })).toBeNull();
  });
});
