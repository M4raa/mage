import { describe, expect, it } from 'vitest';
import { zoomStepForKey } from './browser';

const ctrl = (key: string) => ({ key, control: true, meta: false, alt: false });

describe('zoomStepForKey', () => {
  it('zoomStepForKey_ctrlMasOIgual_acerca', () => {
    expect(zoomStepForKey(ctrl('+'))).toBe(1);
    expect(zoomStepForKey(ctrl('='))).toBe(1);
  });

  it('zoomStepForKey_ctrlMenosYCero_alejaYRestablece', () => {
    expect(zoomStepForKey(ctrl('-'))).toBe(-1);
    expect(zoomStepForKey(ctrl('0'))).toBe(0);
  });

  it('zoomStepForKey_cmd_acerca', () => {
    expect(zoomStepForKey({ key: '+', control: false, meta: true, alt: false })).toBe(1);
  });

  it('zoomStepForKey_sinModificador_null', () => {
    expect(zoomStepForKey({ key: '+', control: false, meta: false, alt: false })).toBeNull();
  });

  it('zoomStepForKey_conAlt_null', () => {
    expect(zoomStepForKey({ key: '0', control: true, meta: false, alt: true })).toBeNull();
  });

  it('zoomStepForKey_otraTecla_null', () => {
    expect(zoomStepForKey(ctrl('k'))).toBeNull();
    expect(zoomStepForKey(ctrl(''))).toBeNull();
  });
});
