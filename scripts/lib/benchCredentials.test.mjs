import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchAccountId, benchApiKey, changedFiles, copiesUnder, credentialFingerprints, userCredentialFiles } from './benchCredentials.mjs';

let tmp = null;
afterEach(() => {
  if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function makeTmp() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-bench-'));
  return tmp;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

describe('benchApiKey', () => {
  it('benchApiKey_claudeConClave_laDevuelveSinEspacios', () => {
    expect(benchApiKey('claude', { MAGE_BENCH_ANTHROPIC_API_KEY: ' sk-prueba ' })).toBe('sk-prueba');
  });
  it('benchApiKey_sinClave_lanzaConLaVariable', () => {
    expect(() => benchApiKey('claude', {})).toThrow(/MAGE_BENCH_ANTHROPIC_API_KEY/);
  });
  it('benchApiKey_claveVacia_lanza', () => {
    expect(() => benchApiKey('claude', { MAGE_BENCH_ANTHROPIC_API_KEY: '  ' })).toThrow();
  });
  it('benchApiKey_codex_lanzaConElProveedor', () => {
    expect(() => benchApiKey('codex', { MAGE_BENCH_ANTHROPIC_API_KEY: 'x' })).toThrow('recibido: "codex"');
  });
});

describe('userCredentialFiles', () => {
  it('userCredentialFiles_home_listaClaudeYCodex', () => {
    expect(userCredentialFiles('/h')).toEqual([path.join('/h', '.claude', '.credentials.json'), path.join('/h', '.codex', 'auth.json')]);
  });
});

describe('credentialFingerprints', () => {
  it('credentialFingerprints_ficheroAusente_null', () => {
    const missing = path.join(makeTmp(), 'no-existe.json');

    expect(credentialFingerprints([missing])).toEqual({ [missing]: null });
  });
});

describe('copiesUnder', () => {
  it('copiesUnder_copiaConOtroNombreDeCarpeta_laEncuentra', () => {
    const base = makeTmp();
    const user = writeFile(path.join(base, 'usuario', '.claude', '.credentials.json'), '{"a":1}');
    const copy = writeFile(path.join(base, 'raiz', 'x', 'y', '.credentials.json'), '{"a":1}');

    expect(copiesUnder(path.join(base, 'raiz'), credentialFingerprints([user]))).toEqual([copy]);
  });
  it('copiesUnder_mismoNombreOtroContenido_noLaCuenta', () => {
    const base = makeTmp();
    const user = writeFile(path.join(base, 'usuario', '.claude', '.credentials.json'), '{"a":1}');
    writeFile(path.join(base, 'raiz', 'x', '.credentials.json'), '{"a":2}');

    expect(copiesUnder(path.join(base, 'raiz'), credentialFingerprints([user]))).toEqual([]);
  });
  it('copiesUnder_sinHuellas_vacio', () => {
    const base = makeTmp();
    writeFile(path.join(base, 'raiz', '.credentials.json'), '{"a":1}');

    expect(copiesUnder(path.join(base, 'raiz'), { [path.join(base, 'ausente')]: null })).toEqual([]);
  });
});

describe('changedFiles', () => {
  it('changedFiles_unoCambia_loDevuelve', () => {
    expect(changedFiles({ a: '1', b: null }, { a: '2', b: null })).toEqual(['a']);
  });
});

describe('benchAccountId', () => {
  it('benchAccountId_dosCuentasDeClaude_devuelveLaDeSuCarpeta', () => {
    const accounts = [{ id: 'H/.claude', providerId: 'claude' }, { id: 'H/.claude-bench', providerId: 'claude' }];

    expect(benchAccountId(accounts, 'H/.claude-bench')).toBe('H/.claude-bench');
  });
  it('benchAccountId_carpetaDeOtroProveedor_lanza', () => {
    const accounts = [{ id: 'X', providerId: 'codex' }];

    expect(() => benchAccountId(accounts, 'X')).toThrow('0 cuentas de Claude');
  });
  it('benchAccountId_cuentaConConfigDirPeroOtroId_lanza', () => {
    const accounts = [{ id: 'otra', providerId: 'claude', configDir: 'H/.claude-bench' }];

    expect(() => benchAccountId(accounts, 'H/.claude-bench')).toThrow('1 cuentas de Claude');
  });
  it('benchAccountId_sinCuentas_lanza', () => {
    expect(() => benchAccountId([], 'X')).toThrow('0 cuentas de Claude');
  });
});
