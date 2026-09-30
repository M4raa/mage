import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractVersionSection } from './changelog.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE = ['# Novedades', '', '## 0.1.2 — en desarrollo', '', '- Nuevo.', '', '## 0.1.1 — 2026-09-30', '- Viejo.'].join('\n');

describe('extractVersionSection', () => {
  it('extractVersionSection_versionConFecha_devuelveSoloSuCuerpo', () => {
    expect(extractVersionSection(SAMPLE, '0.1.2')).toBe('- Nuevo.');
  });

  it('extractVersionSection_ultimaVersion_llegaAlFinalDelFichero', () => {
    expect(extractVersionSection(SAMPLE, '0.1.1')).toBe('- Viejo.');
  });

  it('extractVersionSection_prefijoDeOtraVersion_noLaConfunde', () => {
    expect(() => extractVersionSection('## 0.1.10\n- x', '0.1.1')).toThrow('"0.1.1"');
  });

  it('extractVersionSection_versionAusente_lanzaConLaVersion', () => {
    expect(() => extractVersionSection(SAMPLE, '0.2.0')).toThrow('"0.2.0"');
  });

  it('extractVersionSection_seccionVacia_lanza', () => {
    expect(() => extractVersionSection('## 0.1.0\n\n## 0.0.9\n- x', '0.1.0')).toThrow('vacia');
  });

  it('extractVersionSection_textoVacio_lanza', () => {
    expect(() => extractVersionSection('', '0.1.0')).toThrow('"0.1.0"');
  });
});

// La PUERTA: no se empaqueta una version sin sus notas. Corre en `pnpm check`, que es tambien el primer
// paso de `release.yml`.
describe('CHANGELOG.md del repositorio', () => {
  it('changelog_versionDePackageJson_tieneSeccionConContenido', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf-8');

    expect(extractVersionSection(changelog, version).length).toBeGreaterThan(0);
  });
});
