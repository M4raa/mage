import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Guardia de Z06: verify-gui.mjs y perfBaseline.mjs buscan la interfaz por el texto del catálogo en el idioma de la
// tanda (`ui('clave')`), nunca por un literal castellano. Este test falla si vuelve uno cuyo inglés es distinto.
const readText = (url) => readFileSync(new URL(url, import.meta.url), 'utf8');
const es = JSON.parse(readText('../../src/shared/i18n/catalogs/es.json'));
const en = JSON.parse(readText('../../src/shared/i18n/catalogs/en.json'));

const TRANSLATED_VALUES = new Set(Object.keys(es).filter((key) => en[key] !== es[key]).map((key) => es[key]));
const PREFIXES = new Set([...TRANSLATED_VALUES].filter((value) => value.includes('{')).map((value) => value.slice(0, value.indexOf('{')).trimEnd()).filter((prefix) => prefix.length > 0));
const ATTRIBUTE_SELECTOR = /(aria-label|title|placeholder)(\^|\*)?="([^"]*)"/g;
const BROWSER_METHODS = new Set(['evaluate', 'waitForFunction', 'evaluateAll', 'evaluateHandle', '$eval', '$$eval']);

// Lo que se queda en castellano a propósito: texto exacto -> motivo.
// (Los fragmentos de un mensaje que no son un valor entero no los detecta esta guardia; sus candidatos van en el informe Z06.)
const ALLOWED = new Map([
  ['aria-label^="Mage"', 'nombre propio: el botón de Configuración empieza por «Mage» en castellano y en inglés (F5)'],
]);

const isLiteral = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

// Posiciones en las que un literal no es un texto buscado en la interfaz (clave de objeto, import, directiva…).
function isNeutralPosition(node) {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isTaggedTemplateExpression(parent)) return true;
  if (ts.isExpressionStatement(parent) || ts.isLiteralTypeNode(parent)) return true;
  return ts.isElementAccessExpression(parent) && parent.argumentExpression === node;
}

// Elementos de `CHECKS` con su `name`: se excluyen el valor del `name`, F3.3 entera y F3.1 salvo `state` y `openSection`.
function collectChecks(sourceFile) {
  const checks = [];
  const visit = (node) => {
    const isChecksArray = ts.isVariableDeclaration(node) && node.name.getText() === 'CHECKS' && node.initializer !== undefined && ts.isArrayLiteralExpression(node.initializer);
    if (isChecksArray) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        const nameProp = element.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText() === 'name');
        const nameInit = nameProp?.initializer;
        checks.push({ element, nameInit, nameText: nameInit !== undefined && ts.isStringLiteralLike(nameInit) ? nameInit.text : '' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return checks;
}

function isInsideStateOrOpenSection(node, element) {
  for (let parent = node.parent; parent !== undefined && parent !== element; parent = parent.parent) {
    if (ts.isPropertyAssignment(parent) && parent.parent === element && parent.name.getText() === 'state') return true;
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'openSection') return true;
  }
  return false;
}

function isExcluded(node, checks) {
  const check = checks.find((candidate) => node.getStart() >= candidate.element.getStart() && node.getEnd() <= candidate.element.getEnd());
  if (check === undefined) return false;
  if (check.nameInit === node || check.nameText.startsWith('F3.3:')) return true;
  return check.nameText.startsWith('F3.1:') && !isInsideStateOrOpenSection(node, check.element);
}

function attributeFindings(text) {
  const found = [];
  for (const match of text.matchAll(ATTRIBUTE_SELECTOR)) {
    const [whole, , operator, value] = match;
    if (TRANSLATED_VALUES.has(value) || (operator === '^' && PREFIXES.has(value))) found.push(whole);
  }
  return found;
}

// Hallazgos de un fichero: `{ line, text }` por cada texto castellano del catálogo (con inglés distinto) que no es una clave.
export function findCatalogTexts(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const checks = collectChecks(sourceFile);
  const findings = [];
  const add = (node, text) => {
    if (ALLOWED.has(text) || isExcluded(node, checks)) return;
    findings.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node) => {
    if (isLiteral(node) && !isNeutralPosition(node)) {
      if (TRANSLATED_VALUES.has(node.text)) add(node, node.text);
      else attributeFindings(node.text).forEach((text) => add(node, text));
    }
    if (ts.isRegularExpressionLiteral(node)) {
      const body = /^\/(.*)\/[a-z]*$/s.exec(node.text)?.[1] ?? '';
      if (TRANSLATED_VALUES.has(body)) add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

const describeFindings = (fileName, findings) => findings.map((finding) => `${fileName}:${finding.line} ${finding.text}`).join('\n');

describe('verifyGuiTexts', () => {
  it('verifyGuiTexts_verifyGui_sinTextosCastellanosDelCatalogo', () => {
    const fileName = 'scripts/verify-gui.mjs';
    const findings = findCatalogTexts(readText('../verify-gui.mjs'), fileName);

    expect(describeFindings(fileName, findings)).toBe('');
  });

  it('verifyGuiTexts_perfBaseline_sinTextosCastellanosDelCatalogo', () => {
    const fileName = 'scripts/lib/perfBaseline.mjs';
    const findings = findCatalogTexts(readText('./perfBaseline.mjs'), fileName);

    expect(describeFindings(fileName, findings)).toBe('');
  });

  it('verifyGuiTexts_fuenteConLiteralDelCatalogo_loDetecta', () => {
    const value = es['settings.language.label'];
    const source = `page.getByRole('tab', { name: '${value}' });`;

    const findings = findCatalogTexts(source, 'inventado.mjs');

    expect(findings).toEqual([{ line: 1, text: value }]);
  });

  it('verifyGuiTexts_selectorYRegexConTextoDelCatalogo_losDetecta', () => {
    const value = es['settings.language.label'];
    const source = `page.locator('[aria-label="${value}"]'); page.getByText(/${value}/);`;

    const findings = findCatalogTexts(source, 'inventado.mjs');

    expect(findings.map((finding) => finding.text)).toEqual([`aria-label="${value}"`, `/${value}/`]);
  });
});
