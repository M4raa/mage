import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// H8 (INFORME-051): el `message` del LogBus no se redacta (logBus.ts:45). Ninguna plantilla de `log(…)` de main puede
// interpolar entorno, cabeceras ni nada con nombre de secreto. Lo que haga falta va en `data`, que sí se redacta por
// nombre de campo.
const LOG_TEMPLATE = /\b\w*[lL]og\??\.?\(\s*'(?:debug|info|warn|error)',\s*`((?:[^`\\]|\\.)*)`/g;
const INTERPOLATION = /\$\{([^}]*)\}/g;
const SECRET_SOURCE = /process\.env|\bheaders?\b|authorization|bearer|\btoken\b|accesstoken|refreshtoken|apikey|api_key|secret|password|credential|cookie/i;
const MIN_TEMPLATES = 30;

interface ScanResult {
  readonly templates: number;
  readonly secrets: readonly string[];
}

// Cuenta las plantillas de log de un fuente y devuelve las interpolaciones con pinta de secreto.
function scanLogTemplates(source: string): ScanResult {
  let templates = 0;
  const secrets: string[] = [];
  for (const template of source.matchAll(LOG_TEMPLATE)) {
    templates += 1;
    for (const interpolation of template[1]!.matchAll(INTERPOLATION)) {
      if (SECRET_SOURCE.test(interpolation[1]!)) secrets.push(interpolation[1]!);
    }
  }
  return { templates, secrets };
}

// Los fuentes de `src/main` que no son tests ni declaraciones.
function mainSources(): readonly { readonly file: string; readonly source: string }[] {
  const root = fileURLToPath(new URL('..', import.meta.url));
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'))
    .map((file) => ({ file, source: readFileSync(join(root, file), 'utf8') }));
}

describe('mensajes de log de main', () => {
  it('scanLogTemplates_plantillaConProcessEnv_laDetecta', () => {
    const source = "mainLog('warn', `x ${process.env.FOO}`)";

    const result = scanLogTemplates(source);

    expect(result.templates).toBe(1);
    expect(result.secrets).toEqual(['process.env.FOO']);
  });

  it('scanLogTemplates_plantillaConRutaYError_sinSecretos', () => {
    const source = "this.deps.log?.('warn', `No se pudo leer ${path}: ${describeError(err)}`)";

    const result = scanLogTemplates(source);

    expect(result).toEqual({ templates: 1, secrets: [] });
  });

  it('logsDeMain_ningunaPlantillaInterpolaSecretos_vacio', () => {
    const total = mainSources().reduce(
      (acc, { file, source }) => {
        const result = scanLogTemplates(source);
        return { templates: acc.templates + result.templates, secrets: [...acc.secrets, ...result.secrets.map((s) => `${file}: ${s}`)] };
      },
      { templates: 0, secrets: [] as string[] },
    );

    expect(total.templates).toBeGreaterThanOrEqual(MIN_TEMPLATES);
    expect(total.secrets).toEqual([]);
  });
});
