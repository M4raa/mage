import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConversationAdminService, type ConversationAdminDeps } from './conversationAdminService';
import { resolveTranscriptPath } from '../transcripts/transcriptPath';

// Deps falsas: un set de rutas existentes + espias de las operaciones destructivas.
function makeDeps(existing: readonly string[], over: Partial<ConversationAdminDeps> = {}): {
  deps: ConversationAdminDeps;
  removeFile: ReturnType<typeof vi.fn>;
  removeDir: ReturnType<typeof vi.fn>;
  ensureDir: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
} {
  const set = new Set(existing);
  const removeFile = vi.fn();
  const removeDir = vi.fn();
  const ensureDir = vi.fn();
  const move = vi.fn();
  const deps: ConversationAdminDeps = {
    exists: (p) => set.has(p),
    removeFile,
    removeDir,
    ensureDir,
    move,
    // Sin enlaces: cada ruta es su propio fichero (el caso del junction lo cubre el test de integracion).
    realpath: (p) => p,
    privateProfileDir: (dir) => join(dir, 'mage-private'),
    ensurePrivateProfile: (dir) => join(dir, 'mage-private'),
    ...over,
  };
  return { deps, removeFile, removeDir, ensureDir, move };
}

const ACC = join('/home', '.claude-p');
const ACC2 = join('/home', '.claude-9');
const CWD = '/proj/x';
const SID = 'sess-123';

describe('ConversationAdminService.deleteConversation', () => {
  it('deleteConversation_compartida_borraFichero', () => {
    const file = resolveTranscriptPath(ACC, CWD, SID);
    const { deps, removeFile } = makeDeps([file]);
    new ConversationAdminService(deps).deleteConversation({ accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared' });
    expect(removeFile).toHaveBeenCalledWith(file);
  });

  it('deleteConversation_privada_usaPerfilPrivado', () => {
    const file = resolveTranscriptPath(join(ACC, 'mage-private'), CWD, SID);
    const { deps, removeFile } = makeDeps([file]);
    new ConversationAdminService(deps).deleteConversation({ accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'private' });
    expect(removeFile).toHaveBeenCalledWith(file);
  });

  it('deleteConversation_conSubagentes_borraCarpeta', () => {
    const file = resolveTranscriptPath(ACC, CWD, SID);
    const subDir = join(file, '..', SID); // hermano del .jsonl con el nombre de la sesion
    const { deps, removeDir } = makeDeps([file, join(ACC, 'projects', encoded(CWD), SID)]);
    new ConversationAdminService(deps).deleteConversation({ accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared' });
    expect(removeDir).toHaveBeenCalledWith(join(ACC, 'projects', encoded(CWD), SID));
    void subDir;
  });

  it('deleteConversation_ficheroInexistente_noFalla', () => {
    const { deps, removeFile } = makeDeps([]);
    expect(() =>
      new ConversationAdminService(deps).deleteConversation({ accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared' }),
    ).not.toThrow();
    expect(removeFile).not.toHaveBeenCalled();
  });
});

describe('ConversationAdminService.moveConversation', () => {
  it('moveConversation_compartidaAPrivada_mueveFichero', () => {
    const src = resolveTranscriptPath(ACC, CWD, SID);
    const dest = resolveTranscriptPath(join(ACC, 'mage-private'), CWD, SID);
    const { deps, move, ensureDir } = makeDeps([src]);
    const result = new ConversationAdminService(deps).moveConversation({
      accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared', destAccountDir: ACC, destPrivacy: 'private',
    });
    expect(ensureDir).toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith(src, dest);
    expect(result.configDir).toBe(join(ACC, 'mage-private'));
  });

  it('moveConversation_aOtraCuenta_mueveAlProjectsDelDestino', () => {
    const src = resolveTranscriptPath(ACC, CWD, SID);
    const dest = resolveTranscriptPath(ACC2, CWD, SID);
    const { deps, move } = makeDeps([src]);
    new ConversationAdminService(deps).moveConversation({
      accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared', destAccountDir: ACC2, destPrivacy: 'shared',
    });
    expect(move).toHaveBeenCalledWith(src, dest);
  });

  it('moveConversation_mismoDestino_noHaceNada', () => {
    const src = resolveTranscriptPath(ACC, CWD, SID);
    const { deps, move } = makeDeps([src]);
    const result = new ConversationAdminService(deps).moveConversation({
      accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared', destAccountDir: ACC, destPrivacy: 'shared',
    });
    expect(move).not.toHaveBeenCalled();
    expect(result.configDir).toBe(ACC);
  });

  it('moveConversation_origenInexistente_lanza', () => {
    const { deps } = makeDeps([]);
    expect(() =>
      new ConversationAdminService(deps).moveConversation({
        accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared', destAccountDir: ACC2, destPrivacy: 'shared',
      }),
    ).toThrow(/No existe/);
  });

  it('moveConversation_destinoYaExiste_lanzaSinMoverNada', () => {
    // `rename` sobrescribiria en silencio en POSIX (perdiendo la transcripcion del destino) y fallaria
    // con un error crudo en Windows: se aborta con las dos rutas antes de tocar el disco.
    const src = resolveTranscriptPath(ACC, CWD, SID);
    const dest = resolveTranscriptPath(ACC2, CWD, SID);
    const { deps, move, ensureDir } = makeDeps([src, dest]);

    expect(() =>
      new ConversationAdminService(deps).moveConversation({
        accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared', destAccountDir: ACC2, destPrivacy: 'shared',
      }),
    ).toThrow(/ya existe y no se sobrescribe/i);
    expect(move).not.toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
  });

  it('moveConversation_carpetaDeSubagentesYaExisteEnDestino_lanzaSinMoverElJsonl', () => {
    // La validacion es CONJUNTA: si solo se comprobara el .jsonl, se moveria el fichero y el fallo de
    // la carpeta dejaria la conversacion partida entre dos cuentas.
    const src = resolveTranscriptPath(ACC, CWD, SID);
    const srcSub = join(ACC, 'projects', encoded(CWD), SID);
    const destSub = join(ACC2, 'projects', encoded(CWD), SID);
    const { deps, move } = makeDeps([src, srcSub, destSub]);

    expect(() =>
      new ConversationAdminService(deps).moveConversation({
        accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared', destAccountDir: ACC2, destPrivacy: 'shared',
      }),
    ).toThrow(/ya existe y no se sobrescribe/i);
    expect(move).not.toHaveBeenCalled();
  });

  it('moveConversation_conSubagentes_mueveTambienLaCarpeta', () => {
    const src = resolveTranscriptPath(ACC, CWD, SID);
    const srcSub = join(ACC, 'projects', encoded(CWD), SID);
    const destSub = join(ACC2, 'projects', encoded(CWD), SID);
    const { deps, move } = makeDeps([src, srcSub]);
    new ConversationAdminService(deps).moveConversation({
      accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared', destAccountDir: ACC2, destPrivacy: 'shared',
    });
    expect(move).toHaveBeenCalledWith(srcSub, destSub);
  });
});

// Replica de la codificacion de carpeta del CLI (para construir rutas esperadas en los tests).
function encoded(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

describe('ConversationAdminService con el runtime propio (P-032 R4)', () => {
  const RUNTIME = join('/datos', 'runtime');

  it('deleteConversation_delRuntime_borraSuFichero', () => {
    const file = resolveTranscriptPath(RUNTIME, CWD, SID);
    const { deps, removeFile } = makeDeps([file], { runtimeRoot: RUNTIME });

    new ConversationAdminService(deps).deleteConversation({ accountDir: ACC, sessionId: SID, cwd: CWD, privacy: 'shared' });

    expect(removeFile).toHaveBeenCalledWith(file);
  });

  it('moveConversation_delRuntime_noMueveNada', () => {
    const { deps, move } = makeDeps([resolveTranscriptPath(RUNTIME, CWD, SID)], { runtimeRoot: RUNTIME });

    const result = new ConversationAdminService(deps).moveConversation({
      accountDir: ACC,
      sessionId: SID,
      cwd: CWD,
      privacy: 'shared',
      destAccountDir: ACC2,
      destPrivacy: 'shared',
    });

    expect(move).not.toHaveBeenCalled();
    expect(result).toEqual({ configDir: ACC2 });
  });
});
