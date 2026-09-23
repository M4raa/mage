import { describe, expect, it } from 'vitest';
import { MemoryService, resolveMemoryDir } from './memoryService';

describe('resolveMemoryDir', () => {
  it('accountDirYCwdValidos_construyeRutaBajoMemoryDelProyecto', () => {
    const dir = resolveMemoryDir('C:\\Users\\x\\.claude', 'C:\\sourcecode\\mage');

    expect(dir.replace(/\\/g, '/')).toBe('C:/Users/x/.claude/projects/C--sourcecode-mage/memory');
  });

  it('accountDirVacio_lanza', () => {
    expect(() => resolveMemoryDir('', 'C:\\sourcecode\\mage')).toThrow();
  });
});

describe('MemoryService.read', () => {
  it('carpetaNoExiste_devuelveVacioSinLanzar', () => {
    const service = new MemoryService({ exists: () => false, readdir: () => [], readFile: () => '' });

    expect(service.read('C:\\no\\existe\\memory')).toEqual([]);
  });

  it('carpetaConMd_devuelveSoloLosMdConSuContenido', () => {
    const dir = 'C:\\acc\\projects\\P\\memory';
    const service = new MemoryService({
      exists: () => true,
      readdir: () => ['MEMORY.md', 'feedback_x.md', 'notes.txt', 'sub'],
      readFile: (path) => `contenido de ${path}`,
    });

    const files = service.read(dir);

    expect(files.map((f) => f.fileName)).toEqual(['MEMORY.md', 'feedback_x.md']); // .txt y dir fuera
    expect(files[0]?.content).toContain('MEMORY.md');
  });
});
