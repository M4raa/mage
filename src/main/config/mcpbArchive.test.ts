import { join, resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readMcpb, resolveInside, safeEntryPath, type McpbLimits } from './mcpbArchive';

const MANIFEST = strToU8(JSON.stringify({ manifest_version: '0.3', name: 'x', version: '1.0.0', server: { mcp_config: { command: 'x' } } }));
const LIMITS: McpbLimits = { maxArchiveBytes: 10_000, maxEntries: 5, maxUnpackedBytes: 1_000 };

describe('readMcpb', () => {
  it('readMcpb_paqueteValido_devuelveFicherosSinDirectorios', () => {
    const zip = zipSync({ 'manifest.json': MANIFEST, server: { 'index.js': strToU8('ok') } });

    const contents = readMcpb(zip, LIMITS);

    expect([...contents.files.keys()].sort()).toEqual(['manifest.json', 'server/index.js']);
    expect(contents.unpackedBytes).toBe(MANIFEST.byteLength + 2);
  });

  it('readMcpb_sinManifestEnLaRaiz_lanza', () => {
    expect(() => readMcpb(zipSync({ 'sub/manifest.json': MANIFEST }), LIMITS)).toThrow(/manifest\.json/);
  });

  it('readMcpb_rutaQueSale_lanzaSinInstalarNada', () => {
    expect(() => readMcpb(zipSync({ 'manifest.json': MANIFEST, '../fuera.txt': strToU8('x') }), LIMITS)).toThrow(/no permitida/);
  });

  it('readMcpb_demasiadasEntradas_lanza', () => {
    const files = Object.fromEntries([['manifest.json', MANIFEST], ...[1, 2, 3, 4, 5].map((n) => [`f${n}`, strToU8('x')])]);

    expect(() => readMcpb(zipSync(files), LIMITS)).toThrow(/entradas/);
  });

  it('readMcpb_bombaDeZip_lanzaPorElTamañoDeclarado', () => {
    const zip = zipSync({ 'manifest.json': MANIFEST, 'grande.bin': new Uint8Array(5_000) }, { level: 9 });

    expect(zip.byteLength).toBeLessThan(LIMITS.maxArchiveBytes);
    expect(() => readMcpb(zip, LIMITS)).toThrow(/descomprimido/);
  });

  it('readMcpb_archivoDemasiadoGrande_lanzaSinDescomprimir', () => {
    expect(() => readMcpb(new Uint8Array(LIMITS.maxArchiveBytes + 1), LIMITS)).toThrow(/máximo/);
  });

  it('readMcpb_noEsZip_lanzaConMensaje', () => {
    expect(() => readMcpb(strToU8('no soy un zip'), LIMITS)).toThrow(/No se pudo leer/);
  });
});

describe('safeEntryPath', () => {
  it.each(['/abs.txt', 'C:/x.txt', 'a/../../x', 'a\\..\\x', 'f.txt:ads', 'a\0b'])('safeEntryPath_%s_lanza', (name) => {
    expect(() => safeEntryPath(name)).toThrow(/no permitida/);
  });

  it('safeEntryPath_directorio_null', () => {
    expect(safeEntryPath('server/')).toBeNull();
  });

  it('safeEntryPath_barrasInvertidasYPuntos_normaliza', () => {
    expect(safeEntryPath('server\\.\\bin\\x.exe')).toBe('server/bin/x.exe');
  });
});

describe('resolveInside', () => {
  const root = resolve('/ext/abc');

  it('resolveInside_rutaDentro_absoluta', () => {
    expect(resolveInside(root, 'server/x.js')).toBe(join(root, 'server', 'x.js'));
  });

  it('resolveInside_rutaFuera_lanza', () => {
    expect(() => resolveInside(root, '../abcd/x')).toThrow(/fuera/);
  });
});
