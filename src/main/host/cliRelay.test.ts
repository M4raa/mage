import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliRelayArgs, cliRelayPlan } from './cliRelay';
import { MAGE_MCP_CALLER_ENV } from './mcpCallers';

describe('cliRelayArgs', () => {
  it('cliRelayArgs_sinFlag_null', () => {
    expect(cliRelayArgs(['/opt/x/mage', '--headless'])).toBeNull();
  });

  it('cliRelayArgs_conFlag_loQueVaDetras', () => {
    expect(cliRelayArgs(['/opt/x/mage', '--cli', 'chat', '--new'])).toEqual(['chat', '--new']);
  });

  it('cliRelayArgs_flagAlFinal_vacio', () => {
    expect(cliRelayArgs(['/opt/x/mage', '--cli'])).toEqual([]);
  });
});

describe('cliRelayPlan', () => {
  it('cliRelayPlan_scriptEnResourcesYModoNode', () => {
    const resourcesPath = resolve('r');

    const plan = cliRelayPlan({ execPath: '/opt/Mage/mage', resourcesPath, args: ['stop'], env: { PATH: 'p' } });

    expect(plan.command).toBe('/opt/Mage/mage');
    expect(plan.args).toEqual([join(resourcesPath, 'cli', 'mage.mjs'), 'stop']);
    expect(plan.env['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(plan.env['PATH']).toBe('p');
  });

  // El MCP de Mage en el AppImage se registra como `--cli mcp`: la credencial de la sesión tiene que llegar al relevo
  // para que el host le abra el túnel sin emparejar.
  it('cliRelayPlan_mcpDesdeUnaSesion_pasaLaCredencialDeLaSesion', () => {
    const caller = 'ab'.repeat(32);

    const plan = cliRelayPlan({ execPath: '/opt/Mage/mage', resourcesPath: resolve('r'), args: ['mcp'], env: { [MAGE_MCP_CALLER_ENV]: caller } });

    expect(plan.env[MAGE_MCP_CALLER_ENV]).toBe(caller);
  });
});
