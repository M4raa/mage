// Test de INTEGRACION (P-026 2.7): el fallo era del FS real. `projects/` es un junction a la MISMA
// carpeta en todas las cuentas, asi que «mover» una conversacion compartida de A a B encontraba el
// destino ya ocupado —por el propio fichero— y `assertFreeDestination` lanzaba «El destino ya existe».
// Con mocks eso no se ve: aqui se monta un HOME de mentira con junctions de verdad.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationAdminService } from './conversationAdminService';
import { defaultLinkDeps, LinkService } from '../os/linkService';
import { resolveTranscriptPath } from '../transcripts/transcriptPath';

let home: string;

function service(): ConversationAdminService {
  return new ConversationAdminService({
    exists: existsSync,
    removeFile: (p) => rmSync(p, { force: true }),
    removeDir: (p) => rmSync(p, { recursive: true, force: true }),
    ensureDir: (p) => mkdirSync(p, { recursive: true }),
    move: (from, to) => renameSync(from, to),
    realpath: (p) => realpathSync(p),
    privateProfileDir: (dir) => join(dir, 'mage-private'),
    ensurePrivateProfile: (dir) => join(dir, 'mage-private'),
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mage-move-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('ConversationAdminService.moveConversation (FS real)', () => {
  it('moveConversation_compartida_noMueveFichero', () => {
    const main = join(home, '.claude');
    const other = join(home, '.claude-p');
    mkdirSync(join(main, 'projects'), { recursive: true });
    mkdirSync(other, { recursive: true });
    new LinkService(defaultLinkDeps(() => undefined)).createDirLink(join(main, 'projects'), join(other, 'projects'));
    const file = resolveTranscriptPath(main, 'C:/proj', 'sess-1');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{"type":"user"}\n');

    const result = service().moveConversation({
      accountDir: main,
      sessionId: 'sess-1',
      cwd: 'C:/proj',
      privacy: 'shared',
      destAccountDir: other,
      destPrivacy: 'shared',
    });

    expect(result).toEqual({ configDir: other });
    expect(readFileSync(file, 'utf8')).toBe('{"type":"user"}\n'); // sigue donde estaba, intacta
  });

  it('moveConversation_projectsSeparados_siMueve', () => {
    const main = join(home, '.claude');
    const other = join(home, '.claude-p');
    const file = resolveTranscriptPath(main, 'C:/proj', 'sess-2');
    mkdirSync(dirname(file), { recursive: true });
    mkdirSync(join(other, 'projects'), { recursive: true });
    writeFileSync(file, 'x');

    service().moveConversation({ accountDir: main, sessionId: 'sess-2', cwd: 'C:/proj', privacy: 'shared', destAccountDir: other, destPrivacy: 'shared' });

    expect(existsSync(file)).toBe(false);
    expect(existsSync(resolveTranscriptPath(other, 'C:/proj', 'sess-2'))).toBe(true);
  });
});
