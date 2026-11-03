import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliRelayArgs, cliRelayPlan } from './cliRelay';

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
});
