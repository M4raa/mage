import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function source(file) { return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true); }
function matching(tree, predicate) {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  return found;
}
function position(node, tree) { return `${tree.fileName}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`; }
function nearestFunction(node) {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) if (ts.isFunctionDeclaration(parent)) return parent.name?.text;
  return undefined;
}

describe('baremo de revisión Codex', () => {
  it('funcionesRevisadas_deudaPrevia_noSuperanCuarentaLineas', () => {
    const files = ['src/main/index.ts', 'spike/codex-spike.mjs', 'spike/codex-legacy-verification.mjs', 'scripts/verify-gui.mjs'];
    const names = new Set(['registerIpcHandlers', 'probeAppServer', 'probeInstructions']);

    const violations = files.flatMap((file) => {
      const tree = source(file);
      return matching(tree, (node) => {
        if (ts.isFunctionDeclaration(node)) return names.has(node.name?.text) || /^(register.*Ipc|createIpc|relaySessionEvent|createSessionFromIpc)/.test(node.name?.text ?? '') || file === 'spike/codex-legacy-verification.mjs';
        if (!ts.isMethodDeclaration(node) || node.name.getText(tree) !== 'run') return false;
        return node.parent.properties?.some((property) => ts.isPropertyAssignment(property) && property.name.getText(tree) === 'name' && ts.isStringLiteral(property.initializer) && property.initializer.text.startsWith('MCP y conectores: Conectores con último estado'));
      }).filter((node) => tree.getLineAndCharacterOfPosition(node.end).line - tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 > 40).map((node) => position(node, tree));
    });

    expect(violations).toEqual([]);
  });
  it('igualdad_protocolos_nullUsaComparacionesEstrictas', () => {
    const files = ['src/main/engine/codexProtocol.ts', 'spike/codex-verification.mjs'];

    const violations = files.flatMap((file) => {
      const tree = source(file);
      return matching(tree, (node) => ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)).map((node) => position(node, tree));
    });

    expect(violations).toEqual([]);
  });

  it('limitesOperativos_sondeosEIntervalos_usanConstantesNombradas', () => {
    const files = ['src/main/index.ts', 'spike/codex-verification.mjs', 'spike/codex-real-verification.mjs'];

    const violations = files.flatMap((file) => {
      const tree = source(file);
      return matching(tree, (node) => ts.isNumericLiteral(node) && [50, 100, 250, 300, 1000, 20000].includes(Number(node.text)) &&
        !ts.isVariableDeclaration(node.parent) && (file !== 'src/main/index.ts' || nearestFunction(node) === 'codexAccountProbeDeps')).map((node) => position(node, tree));
    });

    expect(violations).toEqual([]);
  });

  it('testsCasosNuevos_nombresYAct_empatanElBaremoAAA', () => {
    const files = ['src/main/engine/codexAdapter.test.ts', 'src/renderer/src/workbench/engineBlocks.test.ts'];
    const methods = new Set(['normalize', 'mapPermissionToView']);

    const violations = files.flatMap((file) => {
      const tree = source(file);
      const names = matching(tree, (node) => ts.isStringLiteral(node) && node.text === 'encodeUserMessage_esfuerzoBajoLoEnviaEnTurnStart');
      const acts = matching(tree, (node) => ts.isCallExpression(node) && node.expression.getText(tree) === 'expect' &&
        node.arguments.some((argument) => matching(argument, (inner) => ts.isCallExpression(inner) && methods.has(ts.isPropertyAccessExpression(inner.expression) ? inner.expression.name.text : inner.expression.getText(tree))).length > 0));
      // Solo los casos añadidos de MCP y edición, no el resto de tests históricos.
      return [...names, ...acts.filter((node) => {
        for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
          if (ts.isCallExpression(parent) && parent.arguments[0] !== undefined && ts.isStringLiteral(parent.arguments[0])) return /mcpFallido|aprobacionDeEdicionMedida|codexDiffVariasRutas/.test(parent.arguments[0].text);
        }
        return false;
      })].map((node) => position(node, tree));
    });

    expect(violations).toEqual([]);
  });
});
