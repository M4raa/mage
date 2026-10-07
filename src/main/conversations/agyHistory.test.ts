import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgyHistoryService, agyStepsToLines, agyTitleOf, agyWorkspaceOf, type AgyStep, type AgyStore } from './agyHistory';

// Codificador protobuf mínimo para construir pasos sintéticos con la forma medida en agy 1.2.14 / 1.3.1.
const bytes = (...parts: number[][]): number[] => parts.flat();
function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  return [...out, rest];
}
const text = (field: number, value: string): number[] => {
  const data = [...new TextEncoder().encode(value)];
  return bytes(varint(field * 8 + 2), varint(data.length), data);
};
const message = (field: number, ...inner: number[][]): number[] => {
  const data = inner.flat();
  return bytes(varint(field * 8 + 2), varint(data.length), data);
};
const number = (field: number, value: number): number[] => bytes(varint(field * 8), varint(value));
const step = (index: number, stepType: number, ...fields: number[][]): AgyStep => ({ index, stepType, payload: Uint8Array.from([...number(1, stepType), ...fields.flat()]) });

const meta = (extra: number[][] = []): number[] => message(5, message(1, number(1, 1790853405)), ...extra);
const userStep = (index: number, value: string): AgyStep => step(index, 14, meta(), message(19, text(2, value), message(12, message(1), text(12, 'file:///C:/proyecto'))));
const modelStep = (index: number, value: string | null): AgyStep => step(index, 15, meta(), message(20, ...(value === null ? [text(6, 'bot-1')] : [text(1, value)])));
const toolStep = (index: number, type: number, name: string, args: string, output: string): AgyStep =>
  step(index, type, meta([message(4, text(1, `call${index}`), text(2, name), text(3, args))]), message(14, text(3, output)));

const STEPS = [
  userStep(0, 'Lista el proyecto\ny luego resume'),
  modelStep(1, null),
  toolStep(2, 9, 'list_dir', '{"DirectoryPath":"C:\\\\proyecto","toolAction":"Listando","toolSummary":"List"}', 'a.txt\nb.txt'),
  modelStep(3, 'Hay dos ficheros.'),
  step(4, 101, meta(), message(114, text(1, '[Message] aviso del sistema'))),
];

describe('agyStepsToLines', () => {
  const lines = agyStepsToLines(STEPS);

  it('agyStepsToLines_pasosMedidos_usuarioHerramientaYRespuesta', () => {
    expect(lines.map((l) => l.type)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(lines[0]).toMatchObject({ message: { content: 'Lista el proyecto\ny luego resume' } });
    expect(lines[3]).toMatchObject({ message: { content: [{ type: 'text', text: 'Hay dos ficheros.' }] } });
  });

  it('agyStepsToLines_pasoDeHerramienta_emparejaLlamadaYSalidaYQuitaCamposDePresentacion', () => {
    const useBlock = (lines[1] as { message: { content: Record<string, unknown>[] } }).message.content[0]!;
    const resultBlock = (lines[2] as { message: { content: Record<string, unknown>[] } }).message.content[0]!;

    expect(useBlock).toEqual({ type: 'tool_use', id: 'call2', name: 'list_dir', input: { DirectoryPath: 'C:\\proyecto' } });
    expect(resultBlock).toMatchObject({ type: 'tool_result', tool_use_id: 'call2', content: 'a.txt\nb.txt' });
  });

  it('agyStepsToLines_respuestaSinTextoYAvisosDelSistema_noSalen', () => {
    expect(JSON.stringify(lines)).not.toContain('aviso del sistema');
    expect(lines.filter((l) => l.type === 'assistant').length).toBe(2);
  });

  it('agyStepsToLines_payloadQueNoEsProtobuf_seIgnora', () => {
    expect(agyStepsToLines([{ index: 0, stepType: 14, payload: Uint8Array.from([0xff, 0xff, 0xff]) }])).toEqual([]);
  });

  it('agyStepsToLines_pasoDeHerramientaSinMetadatos_seIgnora', () => {
    expect(agyStepsToLines([step(0, 9, meta(), message(14, text(3, 'x')))])).toEqual([]);
  });
});

describe('título y carpeta', () => {
  it('agyTitleOf_primeraEntradaDeUsuario_primeraLineaAcotada', () => {
    expect(agyTitleOf(STEPS)).toBe('Lista el proyecto');
    expect(agyTitleOf([])).toBe('');
  });

  it('agyWorkspaceOf_uriDeArchivo_rutaDelSistema', () => {
    expect(agyWorkspaceOf(STEPS)).toMatch(/proyecto$/);
    expect(agyWorkspaceOf([modelStep(0, 'x')])).toBe('');
  });
});

describe('AgyHistoryService', () => {
  const PROFILE = join('C:', 'perfil');
  const DB = join(PROFILE, '.gemini', 'antigravity-cli', 'conversations', 'aaaa-1111.db');
  const store = (steps: AgyStep[], onRead?: () => void): AgyStore => ({
    exists: (path) => path === DB || DB.startsWith(path),
    listDir: () => ['aaaa-1111.db', 'vieja.pb'],
    stat: () => ({ mtimeMs: 5, sizeBytes: 100 }),
    readSteps: () => steps,
    readFirstUserStep: () => {
      onRead?.();
      return steps.find((s) => s.stepType === 14) ?? null;
    },
  });

  it('list_baseConEntradaDeUsuario_resumenConProveedorAgy', () => {
    const [first, ...rest] = new AgyHistoryService(store(STEPS)).list(PROFILE, 'cfg');

    expect(rest).toEqual([]);
    expect(first).toMatchObject({ sessionId: 'aaaa-1111', configDir: 'cfg', title: 'Lista el proyecto', providerId: 'agy', privacy: 'shared' });
  });

  it('list_baseSinEntradaDeUsuario_noSale', () => {
    expect(new AgyHistoryService(store([modelStep(0, 'x')])).list(PROFILE, 'cfg')).toEqual([]);
  });

  it('list_segundaLlamadaSinCambios_usaLaCache', () => {
    let reads = 0;
    const service = new AgyHistoryService(store(STEPS, () => { reads += 1; }));

    service.list(PROFILE, 'cfg');
    service.list(PROFILE, 'cfg');

    expect(reads).toBe(1);
  });

  it('list_perfilVacio_lanza', () => {
    expect(() => new AgyHistoryService(store(STEPS)).list(' ', 'cfg')).toThrow('Perfil de agy vacio');
  });

  it('findDb_idValidoYExistente_ruta_idConSeparadores_lanza', () => {
    const service = new AgyHistoryService(store(STEPS));

    expect(service.findDb(PROFILE, 'aaaa-1111')).toBe(DB);
    expect(service.findDb(PROFILE, 'otra')).toBeNull();
    expect(() => service.findDb(PROFILE, '..\\x')).toThrow('no valido');
  });
});
