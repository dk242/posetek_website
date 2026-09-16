// Reproduce the recovered component from the pinned public capture. Not a build step.
// No network, source mutation outside this directory, or deployed runtime import.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const output = fileURLToPath(new URL("./", import.meta.url));
const capture = new URL("../../../../../.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/marketing/assets/", import.meta.url);
const sourcePath = fileURLToPath(new URL("TechniqueDemo-DOOeISdl.js", capture));
const text = readFileSync(sourcePath, "utf8");
const digest = value => createHash("sha256").update(value).digest("hex");
if (digest(text) !== "acd73b5eafadda7d2327aa62981c631e719a64657c8f61ca3da7f121f89e2b2f") throw new Error("Technique capture differs from the reviewed deployment");
const program = ts.createProgram([sourcePath], { allowJs: true, noResolve: true, noLib: true });
const source = program.getSourceFile(sourcePath);
const checker = program.getTypeChecker();
const renames = new Map();
const topNames = { n: "TacticalIcon", r: "POSE_EDGES", a: "React", d: "jsxRuntime", f: "techniqueData", p: "projection", m: "lastFrame", h: "initialPhase", g: "initialMetric", _: "jointNames", s: "projectRecordedFrames", c: "nearestPhase", l: "metricForJoint", u: "formatMeasurement", v: "PoseSkeleton", y: "TechniqueDemo" };

function rename(name, replacement) {
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol) renames.set(symbol, replacement);
}
for (const statement of source.statements) {
  if (ts.isImportDeclaration(statement)) {
    for (const binding of statement.importClause.namedBindings.elements) {
      if (topNames[binding.name.text]) rename(binding.name, topNames[binding.name.text]);
    }
  } else if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (topNames[declaration.name.text]) rename(declaration.name, topNames[declaration.name.text]);
    }
  } else if (ts.isFunctionDeclaration(statement) && topNames[statement.name.text]) {
    rename(statement.name, topNames[statement.name.text]);
  }
}

function renameBindings(node, names) {
  if (ts.isIdentifier(node)) {
    if (names[node.text]) rename(node, names[node.text]);
  } else if (ts.isArrayBindingPattern(node) || ts.isObjectBindingPattern(node)) {
    for (const element of node.elements) if (ts.isBindingElement(element)) renameBindings(element.name, names);
  }
}
const component = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === "y");
renameBindings(component.parameters[0].name, { e: "active" });
const stateNames = { t: "instanceId", r: "rootRef", i: "phase", o: "setPhase", _: "frameIndex", y: "setFrameIndex", b: "selectedMetricId", x: "setSelectedMetricId", S: "focusIndex", C: "setFocusIndex", w: "playing", T: "setPlaying", E: "visible", D: "setVisible", O: "showReference", k: "setShowReference", A: "selectedMetric", j: "focusArea", M: "isSnapshot", N: "highlightedJoints", P: "sourceFrame", F: "ball", I: "ballPoint", L: "referencePose", R: "referenceProjection", z: "selectPhase", B: "selectMetric", V: "selectFocusArea" };
for (const statement of component.body.statements) {
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) renameBindings(declaration.name, stateNames);
}
const skeleton = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === "v");
renameBindings(skeleton.parameters[0].name, { e: "points", t: "highlighted", n: "projection", i: "onJoint", a: "phase", o: "selectedId" });

// Convert literal data without executing code from a downloaded bundle.
function literal(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => [property.name.text, literal(property.initializer)]));
  throw new Error(`Unexpected nonliteral data: ${ts.SyntaxKind[node.kind]}`);
}
const dataDeclaration = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(declaration => declaration.name.text === "o");
const data = literal(dataDeclaration.initializer);
function findVariable(path, name) {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  let value;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.text === name) value = literal(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return value;
}
const publishedEdges = findVariable(fileURLToPath(new URL("index-B_aLIfan.js", capture)), "Vu");
const localEdges = findVariable(fileURLToPath(new URL("../pitch/pose-model.ts", import.meta.url)), "POSE_EDGES");
if (JSON.stringify(publishedEdges) !== JSON.stringify(localEdges)) throw new Error("Local pose edges differ from the deployed skeleton");
writeFileSync(output + "technique-data.json", JSON.stringify(data, null, 2) + "\n");

const transformed = ts.transform(source, [context => {
  const expressionStatements = expression => {
    if (ts.isParenthesizedExpression(expression)) return expressionStatements(expression.expression);
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) return [...expressionStatements(expression.left), ...expressionStatements(expression.right)];
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) {
        const condition = expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? expression.left : ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, expression.left);
        return [ts.factory.createIfStatement(condition, ts.factory.createBlock(expressionStatements(expression.right), true))];
      }
    }
    const statement = ts.factory.createExpressionStatement(expression);
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "useEffect") {
      const dependencies = expression.arguments[1];
      if (ts.isArrayLiteralExpression(dependencies) && dependencies.elements.length === 2) ts.addSyntheticLeadingComment(statement, ts.SyntaxKind.SingleLineCommentTrivia, " oxlint-disable-next-line react/set-state-in-effect -- Pause the preserved player when its section or viewport becomes inactive.", true);
      if (ts.isArrayLiteralExpression(dependencies) && dependencies.elements.length === 3) {
        ts.addSyntheticLeadingComment(statement, ts.SyntaxKind.MultiLineCommentTrivia, " oxlint-disable react-hooks/exhaustive-deps -- Capture the starting frame once per playback run; frame updates must not restart its clock. ", true);
        ts.addSyntheticTrailingComment(statement, ts.SyntaxKind.MultiLineCommentTrivia, " oxlint-enable react-hooks/exhaustive-deps ", true);
      }
    }
    return [statement];
  };
  const visit = node => {
    if (ts.isIdentifier(node)) {
      const replacement = renames.get(checker.getSymbolAtLocation(node));
      if (replacement) return ts.factory.createIdentifier(replacement);
    }
    if (ts.isImportDeclaration(node)) return undefined;
    if (ts.isVariableStatement(node) && node.parent === source) {
      const declarations = node.declarationList.declarations.filter(declaration => !["a", "o", "d", "f"].includes(declaration.name.text));
      if (!declarations.length) return undefined;
      node = ts.factory.updateVariableStatement(node, node.modifiers, ts.factory.updateVariableDeclarationList(node.declarationList, declarations));
    }
    if (ts.isFunctionDeclaration(node) && ["s", "c", "l", "u"].includes(node.name.text)) return undefined;
    if (ts.isCallExpression(node) && ts.isParenthesizedExpression(node.expression)) {
      const expression = node.expression.expression;
      if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken && expression.left.getText(source) === "0") {
        node = ts.factory.updateCallExpression(node, expression.right, node.typeArguments, node.arguments);
      }
    }
    node = ts.visitEachChild(node, visit, context);
    if (ts.isBindingElement(node) && node.propertyName?.text === node.name.text) return ts.factory.updateBindingElement(node, node.dotDotDotToken, undefined, node.name, node.initializer);
    if (ts.isExpressionStatement(node)) return expressionStatements(node.expression);
    if (ts.isReturnStatement(node) && node.expression && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.CommaToken) return [...expressionStatements(node.expression.left), ts.factory.createReturnStatement(node.expression.right)];
    // Restore ordinary editable JSX from the emitted JSX-runtime calls.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.text === "jsxRuntime" && ["jsx", "jsxs"].includes(node.expression.name.text)) {
      const [tag, props, key] = node.arguments;
      if (!ts.isObjectLiteralExpression(props)) throw new Error("Unexpected JSX props shape");
      const childValue = props.properties.find(property => property.name?.text === "children")?.initializer;
      const values = childValue ? ts.isArrayLiteralExpression(childValue) ? [...childValue.elements] : [childValue] : [];
      const children = values.length ? [ts.factory.createJsxText("\n"), ...values.flatMap(value => [ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value) ? value : ts.factory.createJsxExpression(undefined, value), ts.factory.createJsxText("\n")])] : [];
      if (ts.isPropertyAccessExpression(tag) && tag.name.text === "Fragment") return ts.factory.createJsxFragment(ts.factory.createJsxOpeningFragment(), children, ts.factory.createJsxJsxClosingFragment());
      const tagName = ts.isStringLiteralLike(tag) ? ts.factory.createIdentifier(tag.text) : tag;
      const attributes = props.properties.filter(property => property.name?.text !== "children").map(property => ts.factory.createJsxAttribute(ts.factory.createIdentifier(property.name.text), ts.factory.createJsxExpression(undefined, property.initializer)));
      // Keep a stable accessible name independent of nested option text.
      if (ts.isStringLiteralLike(tag) && tag.text === "select") attributes.push(ts.factory.createJsxAttribute(ts.factory.createIdentifier("aria-label"), ts.factory.createStringLiteral("Inspect a measurement")));
      if (key) attributes.push(ts.factory.createJsxAttribute(ts.factory.createIdentifier("key"), ts.factory.createJsxExpression(undefined, key)));
      const attrs = ts.factory.createJsxAttributes(attributes);
      return children.length ? ts.factory.createJsxElement(ts.factory.createJsxOpeningElement(tagName, undefined, attrs), children, ts.factory.createJsxClosingElement(tagName)) : ts.factory.createJsxSelfClosingElement(tagName, undefined, attrs);
    }
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length > 1) {
      return node.declarationList.declarations.map(declaration => ts.factory.createVariableStatement(node.modifiers, ts.factory.createVariableDeclarationList([declaration], node.declarationList.flags)));
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(node.operand) && ["0", "1"].includes(node.operand.text)) return node.operand.text === "0" ? ts.factory.createTrue() : ts.factory.createFalse();
    if (ts.isBlock(node)) return ts.factory.createBlock(node.statements, true);
    if (ts.isObjectLiteralExpression(node)) return ts.factory.createObjectLiteralExpression(node.properties, true);
    if (ts.isArrayLiteralExpression(node) && node.elements.length > 2) return ts.factory.createArrayLiteralExpression(node.elements, true);
    return node;
  };
  return node => ts.visitNode(node, visit);
}]);
const header = `/** Recovered from deployment 6aa9b6f0d8faf6177db8fd97. See PROVENANCE.md. */
import * as React from "react";
import { TacticalIcon } from "../TacticalIcon";
import { POSE_EDGES } from "../pitch/pose-model";
import { techniqueData, projectRecordedFrames, nearestPhase, metricForJoint, formatMeasurement } from "./technique-model";
import "./technique.css";
\n`;
const clearSourcePositions = node => { ts.setTextRange(node, { pos: -1, end: -1 }); ts.forEachChild(node, clearSourcePositions); };
clearSourcePositions(transformed.transformed[0]);
let recovered = header + ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]);
const recoveredPath = output + "TechniqueDemo.jsx";
const formattingService = ts.createLanguageService({
  getCompilationSettings: () => ({ allowJs: true, jsx: ts.JsxEmit.Preserve }),
  getScriptFileNames: () => [recoveredPath],
  getScriptVersion: () => "1",
  getScriptSnapshot: path => path === recoveredPath ? ts.ScriptSnapshot.fromString(recovered) : undefined,
  getCurrentDirectory: () => output,
  getDefaultLibFileName: () => "",
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
});
const edits = formattingService.getFormattingEditsForDocument(recoveredPath, { ...ts.getDefaultFormatCodeSettings(), indentSize: 2, tabSize: 2, convertTabsToSpaces: true, newLineCharacter: "\n" });
for (const edit of edits.sort((a, b) => b.span.start - a.span.start)) recovered = recovered.slice(0, edit.span.start) + edit.newText + recovered.slice(edit.span.start + edit.span.length);
formattingService.dispose();
writeFileSync(recoveredPath, recovered);
transformed.dispose();

const css = readFileSync(new URL("TechniqueDemo-BgQuGAyD.css", capture), "utf8");
if (digest(css) !== "cc55f46c18a917ed8f1ec71aad66403f1c99530e9ec829a4f60e36b7e106115b") throw new Error("Technique stylesheet differs from the reviewed deployment");
// Formatting only: preserve every original declaration and scoped selector.
let indent = 0;
const formatted = css.replace(/[{};]/g, token => {
  if (token === "{") { indent++; return " {\n" + "  ".repeat(indent); }
  if (token === "}") { indent--; return "\n" + "  ".repeat(indent) + "}\n" + "  ".repeat(indent); }
  return ";\n" + "  ".repeat(indent);
});
writeFileSync(output + "technique.css", formatted.trim() + "\n");
console.log(JSON.stringify({ frames: data.frames.length, dataSha256: createHash("sha256").update(JSON.stringify(data)).digest("hex"), componentSha256: createHash("sha256").update(text).digest("hex"), cssSha256: createHash("sha256").update(css).digest("hex") }, null, 2));
