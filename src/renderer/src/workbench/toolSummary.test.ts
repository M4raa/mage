import { describe, expect, it } from 'vitest';
import { formatToolMeta, summarizeToolInput, shortToolCommand } from './toolSummary';
import { appendToolUse } from './engineBlocks';
import { extractToolUses } from './toolView';
import type { Block } from './types';
import type { TranscriptEntry } from '@shared/transcripts';

// El UNICO resumen de una tool. Antes habia dos, divergentes, y la misma llamada se veia distinta segun
// viniera del stream en vivo o de reconstruir el hilo desde la transcripcion.

describe('summarizeToolInput', () => {
  it('summarizeToolInput_bash_usaElComando', () => {
    expect(summarizeToolInput('Bash', { command: 'pnpm test', description: 'corre los tests' })).toBe('pnpm test');
  });

  it('summarizeToolInput_ficheroSobreDescripcion', () => {
    expect(summarizeToolInput('Read', { file_path: 'src/a.ts', description: 'lee' })).toBe('src/a.ts');
  });

  it('summarizeToolInput_grep_usaElPatron', () => {
    expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('TODO');
  });

  it('summarizeToolInput_subagente_uneTipoYDescripcion', () => {
    expect(summarizeToolInput('Task', { subagent_type: 'Explore', description: 'buscar el bug' })).toBe('Explore · buscar el bug');
  });

  it('summarizeToolInput_inputVacio_devuelveCadenaVacia', () => {
    expect(summarizeToolInput('ToolRara', {})).toBe('');
  });

  it('summarizeToolInput_textoLarguisimo_seRecorta', () => {
    const summary = summarizeToolInput('Bash', { command: 'x'.repeat(500) });

    expect(summary.length).toBeLessThanOrEqual(121);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('summarizeToolInput_mismoInput_daElMismoResumenQueLaRutaViva', () => {
    // EL test de esta unificacion: la ruta VIVA (appendToolUse, desde el stream) y la ruta HIDRATADA
    // (extractToolUses, desde la transcripcion) tienen que resumir igual la misma llamada.
    const input = { command: 'pnpm run pack' };
    const viva = appendToolUse([], { toolUseId: 't1', toolName: 'Bash', input }, 'b1')[0] as Extract<Block, { kind: 'tool' }>;

    const entry: TranscriptEntry = {
      index: 0,
      uuid: null,
      parentUuid: null,
      isSidechain: false,
      isMeta: false,
      timestampMs: null,
      category: 'turn',
      kind: 'assistant',
      summary: '',
      tokenUsage: null,
      raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input }] } },
    };
    const hidratada = extractToolUses(entry)[0];

    expect(viva.command).toBe(hidratada?.summary);
  });
});

describe('formatToolMeta', () => {
  it('formatToolMeta_conExitCodeEnLaSalida_loPrefiere', () => {
    expect(formatToolMeta({ isError: true, output: 'Exit code 1\nboom', durationMs: 2400 })).toBe('exit 1 · 2.4 s');
  });

  it('formatToolMeta_ok_conDuracionEnMs', () => {
    expect(formatToolMeta({ isError: false, output: 'listo', durationMs: 120 })).toBe('ok · 120 ms');
  });

  it('formatToolMeta_error_sinDuracion', () => {
    expect(formatToolMeta({ isError: true, output: 'fallo', durationMs: null })).toBe('error');
  });
});

// La linea PLEGADA de una herramienta de fichero enseñaba la ruta entera, y con rutas de proyecto
// Java reales (`src/main/java/com/ejemplo/...`) el nombre del fichero —lo unico que se busca con la
// vista— quedaba al final de 90 caracteres. La ruta completa no se pierde: sigue en el `aria-label`,
// en el tooltip y en el pie del bloque desplegado.
describe('shortToolCommand', () => {
  it('rutaDeWindows_soloElNombreDelFichero', () => {
    const corto = shortToolCommand(
      'Edit',
      'C:\\sourcecode\\proyecto\\src\\main\\java\\com\\ejemplo\\proyecto\\agent\\DefinitionRepository.java',
    );

    expect(corto).toBe('DefinitionRepository.java');
  });

  it('rutaPosix_soloElNombreDelFichero', () => {
    expect(shortToolCommand('Read', '/home/quien/proyecto/src/index.ts')).toBe('index.ts');
  });

  it('bash_noSeToca_aunqueParezcaUnaRuta', () => {
    // El comando ES la informacion. `/usr/bin/foo` parece una ruta y no lo es para este caso.
    expect(shortToolCommand('Bash', '/usr/bin/foo --flag')).toBe('/usr/bin/foo --flag');
    expect(shortToolCommand('Bash', 'cd /c/sourcecode && mvn test')).toBe('cd /c/sourcecode && mvn test');
  });

  it('subagente_noSeToca', () => {
    expect(shortToolCommand('Task', 'general-purpose · revisa el login')).toBe('general-purpose · revisa el login');
  });

  it('sinSeparador_seQuedaIgual', () => {
    expect(shortToolCommand('Grep', 'TODO')).toBe('TODO');
  });

  it('acabaEnSeparador_seQuedaIgual', () => {
    // Un directorio: cortar aqui dejaria la cadena vacia, que es peor que la ruta entera.
    expect(shortToolCommand('Read', 'C:\\proyecto\\src\\')).toBe('C:\\proyecto\\src\\');
  });

  it('vacio_devuelveVacio', () => {
    expect(shortToolCommand('Edit', '')).toBe('');
  });
});
