import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SharedConfigService, type SharedConfigDeps } from './sharedConfigService';

// Integracion con FS REAL (mkdtemp aislado), mismo criterio que stateSharing.integration.test.ts: el
// compare-and-swap protege ficheros que edita tambien el usuario y otra instancia de Mage, y con mocks
// no se comprueba lo unico que importa aqui — que la lectura previa a publicar ve de verdad lo que hay
// en disco. Rapido y sin red.

let root = '';

function realDeps(): SharedConfigDeps {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf-8'),
    writeFile: (path, data) => writeFileSync(path, data, 'utf-8'),
    rename: renameSync,
    removeFile: (path) => rmSync(path, { force: true }),
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
    tempSuffix: () => randomUUID(),
    log: () => undefined,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mage-cas-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SharedConfigService compare-and-swap contra FS real', () => {
  const text = (servers: string): string => `{"mcpServers":{${servers}}}`;

  it('cas_nadieToco_guardaYElContenidoLlegaAlDisco', () => {
    const service = new SharedConfigService(realDeps());
    const path = join(root, 'shared-config', 'mcp-common.json');

    const created = service.saveMcpCommonText(path, text('"a":{}'), null);
    const baseline = service.readBaseline(path);
    const updated = service.saveMcpCommonText(path, text('"a":{},"b":{}'), baseline);

    expect(created.status).toBe('saved');
    expect(updated.status).toBe('saved');
    expect(readFileSync(path, 'utf-8')).toBe(text('"a":{},"b":{}'));
  });

  // El caso real: el editor carga, alguien mas escribe el fichero, el usuario guarda.
  it('cas_alguienEscribioEntreMedias_noPisaYDejaElDiscoIntacto', () => {
    const service = new SharedConfigService(realDeps());
    const path = join(root, 'shared-config', 'mcp-common.json');
    service.saveMcpCommonText(path, text('"a":{}'), null);
    const baseline = service.readBaseline(path); // lo que "leyo el editor"

    // Otra instancia de Mage / el usuario a mano, mientras el editor estaba abierto.
    writeFileSync(path, text('"externo":{}'), 'utf-8');

    const outcome = service.saveMcpCommonText(path, text('"mio":{}'), baseline);

    expect(outcome.status).toBe('stale');
    expect(readFileSync(path, 'utf-8')).toBe(text('"externo":{}')); // el cambio ajeno sobrevive
  });

  it('cas_trasElRechazo_releerLaBaseYReintentar_siGuarda', () => {
    const service = new SharedConfigService(realDeps());
    const path = join(root, 'shared-config', 'mcp-common.json');
    service.saveMcpCommonText(path, text('"a":{}'), null);
    const stale = service.readBaseline(path);
    writeFileSync(path, text('"externo":{}'), 'utf-8');
    expect(service.saveMcpCommonText(path, text('"mio":{}'), stale).status).toBe('stale');

    const fresh = service.readBaseline(path);
    const retry = service.saveMcpCommonText(path, text('"mio":{}'), fresh);

    expect(retry.status).toBe('saved');
    expect(readFileSync(path, 'utf-8')).toBe(text('"mio":{}'));
  });

  // Un rechazo no puede ir dejando .tmp por el directorio que lee cualquier lanzamiento del CLI.
  it('cas_rechazoRepetido_noDejaTemporalesHuerfanos', () => {
    const service = new SharedConfigService(realDeps());
    const dir = join(root, 'shared-config');
    const path = join(dir, 'mcp-common.json');
    service.saveMcpCommonText(path, text('"a":{}'), null);
    const baseline = service.readBaseline(path);
    writeFileSync(path, text('"externo":{}'), 'utf-8');

    for (let i = 0; i < 5; i++) service.saveMcpCommonText(path, text(`"m${i}":{}`), baseline);

    expect(readdirSync(dir)).toEqual(['mcp-common.json']);
  });

  it('cas_creacionCuandoOtroYaCreoElFichero_rechaza', () => {
    const service = new SharedConfigService(realDeps());
    const dir = join(root, 'shared-config');
    const path = join(dir, 'mcp-common.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, text('"externo":{}'), 'utf-8');

    const outcome = service.saveMcpCommonText(path, text('"mio":{}'), null);

    expect(outcome.status).toBe('stale');
    expect(readFileSync(path, 'utf-8')).toBe(text('"externo":{}'));
  });

  // Ausente y vacio son estados distintos: un fichero de 0 bytes no puede tratarse como "no existe".
  it('cas_ficheroVacioNoEsAusente', () => {
    const service = new SharedConfigService(realDeps());
    const dir = join(root, 'shared-config');
    const path = join(dir, 'mcp-common.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, '', 'utf-8');

    expect(service.readBaseline(path)).toBe('');
    expect(service.saveMcpCommonText(path, text(''), null).status).toBe('stale');
    expect(service.saveMcpCommonText(path, text(''), '').status).toBe('saved');
  });
});
