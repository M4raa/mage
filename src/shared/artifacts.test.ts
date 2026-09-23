import { describe, expect, it } from 'vitest';
import { completeArtifactPublication, isArtifactUrl, parseArtifactDraft } from './artifacts';

// El `tool_use` y el `tool_result` LITERALES medidos en una transcripcion real del usuario.
const REAL_INPUT = {
  file_path: 'C:\\Users\\USUARIO\\AppData\\Local\\Temp\\claude\\proyecto\\scratchpad\\packaging-informe.html',
  favicon: '📦',
  title: 'Packaging — informe previo',
  description: 'Análisis previo (Pasos 0–1) de la normalización de la entidad #2 Packaging.',
};

const REAL_RESULT =
  'Published C:\\Users\\USUARIO\\AppData\\Local\\Temp\\claude\\proyecto\\scratchpad\\packaging-informe.html at ' +
  'https://claude.ai/code/artifact/477497ff-717a-4375-a39e-a47e383648a8\n\n' +
  'Warning: The document\'s own <title> ("Análisis previo — Packaging") names this artifact; the `title` parameter was not applied';

describe('parseArtifactDraft', () => {
  it('parseArtifactDraft_inputSinTitle_tituloCaeAlNombreDelFichero', () => {
    // En la tarjeta hay que ver ALGO, y la ruta entera del scratchpad no es un titulo.
    const draft = parseArtifactDraft('Artifact', { file_path: 'C:\\tmp\\scratchpad\\informe.html' });

    expect(draft?.title).toBe('informe.html');
  });

  it('parseArtifactDraft_faviconAusente_devuelveCadenaVacia', () => {
    expect(parseArtifactDraft('Artifact', { file_path: 'a.html', title: 'T' })?.favicon).toBe('');
  });

  it('parseArtifactDraft_toolQueNoEsArtifact_devuelveNull', () => {
    expect(parseArtifactDraft('Bash', { command: 'ls' })).toBeNull();
  });
});

describe('completeArtifactPublication', () => {
  it('completeArtifactPublication_sinResultadoTodavia_devuelveNull', () => {
    // Mientras la tool corre no hay URL: se pinta la caja normal, no una tarjeta con un boton muerto.
    const draft = parseArtifactDraft('Artifact', REAL_INPUT);

    expect(completeArtifactPublication(draft!, '')).toBeNull();
  });
});

describe('isArtifactUrl', () => {
  it('isArtifactUrl_urlReal_esValida', () => {
    expect(isArtifactUrl('https://claude.ai/code/artifact/477497ff-717a-4375-a39e-a47e383648a8')).toBe(true);
  });

  it('isArtifactUrl_otrasUrls_noLoSon', () => {
    expect(isArtifactUrl('https://claude.ai/code/artifact/')).toBe(false);
    expect(isArtifactUrl('https://claude.ai/chat/abc')).toBe(false);
    expect(isArtifactUrl('file:///C:/x.html')).toBe(false);
    expect(isArtifactUrl('')).toBe(false);
  });
});
