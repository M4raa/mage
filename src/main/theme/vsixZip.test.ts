import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {  readZipMemberText } from './vsixZip';

// Constructor de ZIP minimo para los tests (store o deflate). No calcula CRC (el lector no lo valida).
// Valida el parser contra buffers reales: offsets, firmas y el roundtrip de inflate de zlib.
interface ZipFile {
  readonly name: string;
  readonly content: string;
  readonly deflate?: boolean;
}

function buildZip(files: readonly ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.content, 'utf8');
    const method = file.deflate === true ? 8 : 0;
    const data = method === 8 ? deflateRawSync(raw) : raw;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc (no validado)
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16); // crc
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('vsixZip', () => {
  it('readZipMemberText_almacenado_devuelveContenido', () => {
    const zip = buildZip([{ name: 'extension/theme/dracula.json', content: '{"colors":{}}' }]);
    expect(readZipMemberText(zip, 'theme/dracula.json')).toBe('{"colors":{}}');
  });

  it('readZipMemberText_deflate_descomprime', () => {
    const body = '{"colors":{"editor.background":"#282a36"}}';
    const zip = buildZip([{ name: 'extension/theme/dracula.json', content: body, deflate: true }]);
    expect(readZipMemberText(zip, 'theme/dracula.json')).toBe(body);
  });

  it('readZipMemberText_sufijoIgnoraPrefijoExtension_yCase', () => {
    const zip = buildZip([{ name: 'Extension/Theme/Dracula.json', content: 'ok' }]);
    expect(readZipMemberText(zip, './theme/dracula.json')).toBe('ok');
  });

  it('readZipMemberText_variosMiembros_eligeElCorrecto', () => {
    const zip = buildZip([
      { name: 'extension/package.json', content: '{"a":1}' },
      { name: 'extension/theme/light.json', content: 'LIGHT' },
      { name: 'extension/theme/dark.json', content: 'DARK', deflate: true },
    ]);
    expect(readZipMemberText(zip, 'theme/dark.json')).toBe('DARK');
    expect(readZipMemberText(zip, 'theme/light.json')).toBe('LIGHT');
  });

  it('readZipMemberText_miembroInexistente_lanza', () => {
    const zip = buildZip([{ name: 'extension/package.json', content: '{}' }]);
    expect(() => readZipMemberText(zip, 'theme/nope.json')).toThrow(/no contiene/);
  });

  it('readZipMemberText_bufferNoZip_lanza', () => {
    expect(() => readZipMemberText(Buffer.from('no soy un zip'), 'x')).toThrow(/ZIP invalido/);
  });

});
