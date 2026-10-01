import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgyAdapter } from './agyAdapter';
import { ClaudeAdapter } from './claudeAdapter';
import { CodexAdapter } from './codexAdapter';
import type { LaunchParams } from './providerAdapter';

// Invariante de facturacion (CLAUDE.md, grupo E): las claves de API solo llegan al hijo de SU cuenta de
// API, las pone solo el adapter de su CLI, y una clave exportada en el entorno del usuario no llega a
// ningun hijo. Se comprueba sobre los cuatro adapters a la vez.

const USER_KEYS = { ANTHROPIC_API_KEY: 'sk-ant-usuario', GEMINI_API_KEY: 'gm-usuario', OPENAI_API_KEY: 'sk-oa-usuario', CODEX_API_KEY: 'sk-cx-usuario' };
const API_DIR = '/home/u/.claude-api';
const launch = (accountDir: string): LaunchParams => ({ sessionId: 's1', accountDir, model: 'm', cwd: '/proj' });
const claudeKeyFor = (dir: string): string | null => (dir === API_DIR ? 'sk-ant-de-la-cuenta' : null);

let previous: Record<string, string | undefined> = {};
beforeEach(() => {
  previous = Object.fromEntries(Object.keys(USER_KEYS).map((name) => [name, process.env[name]]));
  Object.assign(process.env, USER_KEYS);
});
afterEach(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function envOfEverySubscriptionChild(): NodeJS.ProcessEnv[] {
  return [
    new ClaudeAdapter(() => 'claude', undefined, claudeKeyFor).buildSpawnPlan(launch('/home/u/.claude')).env,
    new AgyAdapter({ resolveBinary: () => 'agy' }).buildSpawnPlan(launch(API_DIR)).env,
    new CodexAdapter({ resolveBinary: () => 'codex' }).buildSpawnPlan(launch(API_DIR)).env,
  ];
}

describe('invariante de claves de API', () => {
  it('suscripcion_conClavesDelUsuarioEnElEntorno_ningunHijoRecibeNinguna', () => {
    for (const env of envOfEverySubscriptionChild()) {
      for (const [name, value] of Object.entries(USER_KEYS)) {
        expect(env[name], name).toBeUndefined();
        expect(Object.values(env)).not.toContain(value);
      }
    }
  });

  it('cuentaDeClaudePorApi_soloSuHijoRecibeSuClave', () => {
    const own = new ClaudeAdapter(() => 'claude', undefined, claudeKeyFor).buildSpawnPlan(launch(API_DIR)).env;

    expect(own.ANTHROPIC_API_KEY).toBe('sk-ant-de-la-cuenta');
    for (const env of envOfEverySubscriptionChild()) expect(Object.values(env)).not.toContain('sk-ant-de-la-cuenta');
  });
});
