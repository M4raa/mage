import { describe, expect, it } from 'vitest';
import { createRuntimeGate, decidePermission, isContainedCommand } from './permissionGate';
import type { RuntimePermissionMode } from './runtimeSession';
import type { ToolKind } from './agentLoop';

const SCOPE = { cwd: '/proj', extraDirs: [], platform: 'linux' };
const MODES: RuntimePermissionMode[] = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'];
const KINDS: ToolKind[] = ['read', 'edit', 'exec'];

// Tabla esperada DENTRO del cwd (exec con un comando local inocuo).
const INSIDE: Record<RuntimePermissionMode, Record<ToolKind, string>> = {
  plan: { read: 'allow', edit: 'deny', exec: 'deny' },
  default: { read: 'allow', edit: 'ask', exec: 'ask' },
  acceptEdits: { read: 'allow', edit: 'allow', exec: 'ask' },
  auto: { read: 'allow', edit: 'allow', exec: 'allow' },
  bypassPermissions: { read: 'allow', edit: 'allow', exec: 'allow' },
};

describe('decidePermission', () => {
  it('decide_fullTableInside_matchesSpec', () => {
    for (const mode of MODES) {
      for (const kind of KINDS) {
        const verdict = decidePermission({ mode, kind, pathClass: kind === 'exec' ? null : 'inside', command: kind === 'exec' ? 'ls src' : null, scope: SCOPE });
        expect(verdict.verdict, `${mode}/${kind}`).toBe(INSIDE[mode][kind]);
      }
    }
  });

  it('decide_outsidePath_asksInEveryModeButPlanDeniesEdits', () => {
    for (const mode of MODES) {
      for (const kind of ['read', 'edit'] as const) {
        const verdict = decidePermission({ mode, kind, pathClass: 'outside', command: null, scope: SCOPE });
        const expected = mode === 'plan' && kind === 'edit' ? 'deny' : 'ask';
        expect(verdict.verdict, `${mode}/${kind}`).toBe(expected);
      }
    }
  });

  it('decide_planDeny_givesReason', () => {
    expect(decidePermission({ mode: 'plan', kind: 'edit', pathClass: 'inside', command: null, scope: SCOPE })).toEqual({ verdict: 'deny', reason: 'modo Plan: solo lectura' });
  });

  it('decide_autoNetworkCommand_asks', () => {
    expect(decidePermission({ mode: 'auto', kind: 'exec', pathClass: null, command: 'curl https://x.com', scope: SCOPE }).verdict).toBe('ask');
  });

  it('decide_autoOpaqueExec_asks', () => {
    expect(decidePermission({ mode: 'auto', kind: 'exec', pathClass: null, command: null, scope: SCOPE }).verdict).toBe('ask');
  });
});

describe('isContainedCommand', () => {
  it('contained_localCommands_true', () => {
    expect(['ls -la', 'cat src/a.ts', 'pnpm test', 'git status', 'node scripts/x.mjs'].map((c) => isContainedCommand(c, SCOPE))).toEqual([true, true, true, true, true]);
  });

  it('contained_networkOrOutside_false', () => {
    const commands = ['git push origin main', 'npm install left-pad', 'cat /etc/passwd', 'rm -rf ../otro', 'ls ~/.ssh', 'npx cowsay', 'wget x'];
    expect(commands.map((c) => isContainedCommand(c, SCOPE))).toEqual(commands.map(() => false));
  });
});

describe('createRuntimeGate', () => {
  it('gate_readOutsideCwd_asks', () => {
    const gate = createRuntimeGate(SCOPE);

    expect(gate({ id: '1', name: 'Read', kind: 'read', input: { file_path: '/etc/hosts' } }, 'bypassPermissions')).toEqual({ verdict: 'ask' });
  });

  it('gate_bashUsesCommandInAuto', () => {
    const gate = createRuntimeGate(SCOPE);

    expect(gate({ id: '1', name: 'Bash', kind: 'exec', input: { command: 'pnpm test' } }, 'auto')).toEqual({ verdict: 'allow' });
  });
});
