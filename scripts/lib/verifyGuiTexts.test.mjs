import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { messageSegments } from './uiText.mjs';

// Guardia de Z06: verify-gui.mjs y perfBaseline.mjs buscan la interfaz por el texto del catálogo en el idioma de la
// tanda (`ui('clave')`), nunca por un literal castellano. Este test falla si vuelve uno cuyo inglés es distinto.
const readText = (url) => readFileSync(new URL(url, import.meta.url), 'utf8');
const es = JSON.parse(readText('../../src/shared/i18n/catalogs/es.json'));
const en = JSON.parse(readText('../../src/shared/i18n/catalogs/en.json'));

const TRANSLATED_VALUES = new Set(Object.keys(es).filter((key) => en[key] !== es[key]).map((key) => es[key]));
const PREFIXES = new Set([...TRANSLATED_VALUES].filter((value) => value.includes('{')).map((value) => value.slice(0, value.indexOf('{')).trimEnd()).filter((prefix) => prefix.length > 0));
const MIN_SEGMENT_LENGTH = 8;
const MIN_GAP_FIXED = 4;
const HAS_VARIABLE = /\{\w+\}/;
const ICU_FORMAT = /\{\s*\w+\s*,/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// (d) Mensajes con variables simples -> regex que casa con el mensaje con cada variable rellena (se construye una vez).
const GAP_PATTERNS = [...TRANSLATED_VALUES]
  .filter((value) => !ICU_FORMAT.test(value) && HAS_VARIABLE.test(value))
  .map((value) => messageSegments(value))
  .filter((parts) => parts.join('').trim().length >= MIN_GAP_FIXED)
  .map((parts) => new RegExp(`^${parts.map(escapeRegExp).join('[\\s\\S]+?')}$`));

// (e) Tramos fijos (8 o más caracteres, con trim) de los mensajes traducidos.
const FIXED_SEGMENTS = new Set([...TRANSLATED_VALUES].flatMap((value) => messageSegments(value)).map((segment) => segment.trim()).filter((segment) => segment.length >= MIN_SEGMENT_LENGTH));

// Valor entero, mensaje con el hueco relleno (d) o tramo fijo (e).
function matchesCatalogText(text) {
  const trimmed = text.trim();
  return TRANSLATED_VALUES.has(text) || GAP_PATTERNS.some((pattern) => pattern.test(trimmed)) || FIXED_SEGMENTS.has(trimmed);
}

// (f) Alternativas de primer nivel (fuera de `(…)` y `[…]`) del cuerpo de una regex, sin `^`/`$` de borde ni barras de escape.
function regexAlternatives(body) {
  const alternatives = [];
  let depth = 0;
  let inClass = false;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '\\') {
      current += char + (body[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (inClass) inClass = char !== ']';
    else if (char === '[') inClass = true;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === '|' && depth === 0 && !inClass) {
      alternatives.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  alternatives.push(current);
  return alternatives;
}

// Trozos de texto fijo de una alternativa: se corta en las clases (`\d`, `\s`...) y en `.*`/`.+`, y se quita la barra de escape.
const regexTexts = (alternative) => alternative.replace(/^\^/, '').replace(/\$$/, '').split(/\\[dswDSWb]|\.[*+]\??/).map((piece) => piece.replace(/\\(.)/g, '$1'));

function regexMatchesCatalog(body) {
  return regexAlternatives(body).some((alternative) => {
    const whole = alternative.replace(/^\^/, '').replace(/\$$/, '').replace(/\\(.)/g, '$1');
    if (matchesCatalogText(whole)) return true;
    return regexTexts(alternative).some(matchesCatalogText);
  });
}

const ATTRIBUTE_SELECTOR = /(aria-label|title|placeholder)(\^|\*)?="([^"]*)"/g;
const BROWSER_METHODS = new Set(['evaluate', 'waitForFunction', 'evaluateAll', 'evaluateHandle', '$eval', '$$eval']);

// Lo que se queda en castellano a propósito: texto exacto -> motivo.
// Limitación: los textos de mensajes plural/select (p. ej. «2 terminados») no se ven si el literal no coincide con un tramo fijo.
const ALLOWED = new Map([
  ['aria-label^="Mage"', 'nombre propio: el botón de Configuración empieza por «Mage» en castellano y en inglés (F5)'],
  // Z07, B6: texto que la comprobación INYECTA como dato de prueba (fixtures) o texto del propio harness; no se busca en la interfaz.
  ['Respuesta ', 'contenido de un bloque de agente inyectado como fixture (verify-gui.mjs y perfBaseline.mjs); no se busca en la interfaz'],
  ['Pregunta ', 'contenido de un bloque de usuario inyectado como fixture; no se busca en la interfaz'],
  ['Proyecto uno', 'título de una fila de historial inyectada como fixture; no se busca en la interfaz'],
  ['Proyecto dos', 'título de una fila de historial inyectada como fixture; no se busca en la interfaz'],
  ['Solo titulo', 'título de un artifact de prueba (fixture); no se busca en la interfaz'],
  ['agy denegó el comando «', 'mensaje de un bloque de error inyectado: la comprobación busca el botón por [data-agy-allow-command], no este texto'],
  ['agy denegó la herramienta MCP «', 'mensaje de un bloque de error inyectado: la comprobación busca el botón por [data-agy-allow-command], no este texto'],
  ['Solo conversaciones sin cuenta: ', 'mensaje de error del propio harness; no se busca en la interfaz'],
  // Z07, B7.
  ['Cuenta no valida', 'aviso antiguo que la comprobación exige AUSENTE; ya no existe en el catálogo (sin tilde a propósito)'],
]);

// Un trozo de plantilla (head/middle/tail) de una plantilla etiquetada (`tag\`…\``) no es un texto buscado en la interfaz.
function isTaggedTemplatePart(node) {
  const template = ts.isTemplateHead(node) ? node.parent : node.parent.parent;
  return ts.isTaggedTemplateExpression(template.parent);
}

const isLiteral =(node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

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
      if (matchesCatalogText(node.text)) add(node, node.text);
      else attributeFindings(node.text).forEach((text) => add(node, text));
    }
    const isTemplatePart = ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (isTemplatePart && !isTaggedTemplatePart(node) && matchesCatalogText(node.text)) add(node, node.text);
    if (ts.isRegularExpressionLiteral(node)) {
      const body = /^\/(.*)\/[a-z]*$/s.exec(node.text)?.[1] ?? '';
      if (regexMatchesCatalog(body)) add(node, node.text);
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

  it('verifyGuiTexts_mensajeConHuecoRelleno_loDetecta', () => {
    const literal = 'El inicio de sesión de Codex no terminó (403: denegado)';
    const source = `page.getByText('${literal}');`;

    const findings = findCatalogTexts(source, 'inventado.mjs');

    expect(findings).toEqual([{ line: 1, text: literal }]);
  });

  it('verifyGuiTexts_tramoFijo_loDetecta', () => {
    const segment = '. Esta cuenta FACTURA LA API: sus pestañas llevan la marca «';
    const source = `page.getByText('${segment}'); const t = \`${segment}\${badge}\`;`;

    const findings = findCatalogTexts(source, 'inventado.mjs');

    expect(findings.map((finding) => finding.text)).toEqual([segment, segment]);
  });

  it('verifyGuiTexts_regexConAlternativas_detectaCadaUna', () => {
    const a = escapeRegExp(es['settings.language.label']);
    const b = escapeRegExp(es['accounts.add.agy.checking']);

    const onlyA = findCatalogTexts(`x.test(/${a}|nada de nada/);`, 'inventado.mjs');
    const onlyB = findCatalogTexts(`x.test(/nada de nada|${b}/);`, 'inventado.mjs');
    const both = findCatalogTexts(`x.test(/${a}|${b}/);`, 'inventado.mjs');

    expect([onlyA.length, onlyB.length, both.length]).toEqual([1, 1, 1]);
    expect(both[0].text).toBe(`/${a}|${b}/`);
  });

  it('verifyGuiTexts_tramoCorto_noLoDetecta', () => {
    const source = "page.getByText('terminó'); page.getByText(': ');";

    const findings = findCatalogTexts(source, 'inventado.mjs');

    expect(findings).toEqual([]);
  });

  it('verifyGuiTexts_textoAjeno_noLoDetecta', () => {
    const findings = findCatalogTexts("page.getByText('hola mundo de prueba');", 'inventado.mjs');

    expect(findings).toEqual([]);
  });

  it('verifyGuiTexts_selectorYRegexConTextoDelCatalogo_losDetecta', () => {
    const value = es['settings.language.label'];
    const source = `page.locator('[aria-label="${value}"]'); page.getByText(/${value}/);`;

    const findings = findCatalogTexts(source, 'inventado.mjs');

    expect(findings.map((finding) => finding.text)).toEqual([`aria-label="${value}"`, `/${value}/`]);
  });
});
