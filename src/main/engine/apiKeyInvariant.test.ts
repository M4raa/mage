import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgyAdapter } from './agyAdapter';
import { ClaudeAdapter } from './claudeAdapter';
import { CodexAdapter } from './codexAdapter';
import type { LaunchParams } from './providerAdapter';
import { TEST_ANTHROPIC_BASE_URL_ENV } from '../os/agentEnv';

// Invariante de facturacion (CLAUDE.md, grupo E): las claves de API solo llegan al hijo de SU cuenta de
// API, las pone solo el adapter de su CLI, y una clave exportada en el entorno del usuario no llega a
// ningun hijo. Se comprueba sobre los cuatro adapters a la vez.

const USER_KEYS = {
  ANTHROPIC_BASE_URL: 'https://proxy-del-usuario.example',
  ANTHROPIC_API_KEY: 'sk-ant-usuario',
  GEMINI_API_KEY: 'gm-usuario',
  OPENAI_API_KEY: 'sk-oa-usuario',
  CODEX_API_KEY: 'sk-cx-usuario',
  CLAUDE_CODE_USE_FOUNDRY: '1-usuario',
  ANTHROPIC_FOUNDRY_API_KEY: 'fd-usuario',
  ANTHROPIC_FOUNDRY_BASE_URL: 'https://foundry-del-usuario.example',
  ANTHROPIC_FOUNDRY_RESOURCE: 'recurso-usuario',
  AWS_BEARER_TOKEN_BEDROCK: 'bedrock-usuario',
  ANTHROPIC_CUSTOM_HEADERS: 'X-Proxy-Auth: cabecera-usuario',
  OPENAI_BASE_URL: 'https://openai-del-usuario.example',
  GOOGLE_GENAI_USE_VERTEXAI: 'true-usuario',
};
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
    new ClaudeAdapter({ resolveBinary: () => 'claude', resolveApiKey: claudeKeyFor }).buildSpawnPlan(launch('/home/u/.claude')).env,
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

  it('suscripcionDeClaude_conFoundryYCabecerasExportadas_elHijoNoLasRecibe', () => {
    const env = new ClaudeAdapter({ resolveBinary: () => 'claude', resolveApiKey: claudeKeyFor }).buildSpawnPlan(launch('/home/u/.claude')).env;

    expect(env.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined();
    expect(env.ANTHROPIC_FOUNDRY_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('cuentaDeClaudePorApi_soloSuHijoRecibeSuClave', () => {
    const own = new ClaudeAdapter({ resolveBinary: () => 'claude', resolveApiKey: claudeKeyFor }).buildSpawnPlan(launch(API_DIR)).env;

    expect(own.ANTHROPIC_API_KEY).toBe('sk-ant-de-la-cuenta');
    for (const env of envOfEverySubscriptionChild()) expect(Object.values(env)).not.toContain('sk-ant-de-la-cuenta');
  });
});

// T6: la unica redireccion de endpoint permitida, solo de pruebas (agentEnv.ts, decideTestAnthropicBaseUrl).
describe('invariante de claves de API: T6', () => {
  const TEST_URL = 'http://127.0.0.1:4567';
  let previousTestUrl: string | undefined;
  beforeEach(() => {
    previousTestUrl = process.env[TEST_ANTHROPIC_BASE_URL_ENV];
    process.env[TEST_ANTHROPIC_BASE_URL_ENV] = TEST_URL;
  });
  afterEach(() => {
    if (previousTestUrl === undefined) delete process.env[TEST_ANTHROPIC_BASE_URL_ENV];
    else process.env[TEST_ANTHROPIC_BASE_URL_ENV] = previousTestUrl;
  });
  const envFor = (accountDir: string, isPackaged: boolean): NodeJS.ProcessEnv =>
    new ClaudeAdapter({
      resolveBinary: () => 'claude',
      resolveApiKey: claudeKeyFor,
      testBaseUrl: () => process.env[TEST_ANTHROPIC_BASE_URL_ENV],
      isPackaged: () => isPackaged,
    }).buildSpawnPlan(launch(accountDir)).env;

  it('t6_suscripcionSinEmpaquetar_noRecibeBaseUrl', () => {
    // La variable de pruebas en si se hereda (no es credencial); lo que importa es que no redirija el endpoint.
    expect(envFor('/home/u/.claude', false).ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('t6_apiEmpaquetada_noRecibeBaseUrl', () => {
    expect(envFor(API_DIR, true).ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('t6_apiSinEmpaquetarLoopback_recibeLaDePruebaYSuClave', () => {
    const env = envFor(API_DIR, false);

    expect(env.ANTHROPIC_BASE_URL).toBe(TEST_URL);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-de-la-cuenta');
  });

  it('t6_baseUrlDelUsuario_nuncaLlega', () => {
    process.env[TEST_ANTHROPIC_BASE_URL_ENV] = 'http://example.com:8080'; // ignorada
    for (const env of [envFor(API_DIR, false), envFor('/home/u/.claude', false), envFor(API_DIR, true)]) {
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(Object.values(env)).not.toContain(USER_KEYS.ANTHROPIC_BASE_URL);
    }
  });
});
