// Recover the public component without executing the deployed JavaScript.
// This is an archaeology tool, not an installation/build step. See PROVENANCE.md.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const output = fileURLToPath(new URL("./", import.meta.url));
const capture = new URL("../../../../.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/assets/", import.meta.url);
const sourcePath = fileURLToPath(new URL("FeedPage-Cm50ZtLq.js", capture));
const text = readFileSync(sourcePath, "utf8");
const digest = value => createHash("sha256").update(value).digest("hex");
if (digest(text) !== "ad8911444f7a33feb55162a9cf524b57b829b331e938162cad92b99198addce4") throw new Error("Feed capture differs from the reviewed deployment");
const program = ts.createProgram([sourcePath], { allowJs: true, noResolve: true, noLib: true });
const source = program.getSourceFile(sourcePath);
const checker = program.getTypeChecker();
const renames = new Map();
const topNames = {
  c: "React", _: "jsxRuntime", t: "useNavigate", i: "useLocation", r: "Link", s: "auth",
  l: "callSocial", u: "formatMeasurement", d: "mergeActivities", f: "initials", p: "formatDate",
  m: "sampleContext", h: "sampleActivityDefaults", g: "sampleActivities", v: "feedScopes", y: "audienceLabels",
  b: "Icon", x: "FeedPage", S: "ActivityCard", C: "Comments", w: "People", T: "SharingSettings",
  E: "Moderation", D: "AdminDirectory",
};
function rename(name, replacement) {
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol) renames.set(symbol, replacement);
}
function renameBindings(node, names) {
  if (ts.isIdentifier(node)) {
    if (names[node.text]) rename(node, names[node.text]);
  } else if (ts.isArrayBindingPattern(node) || ts.isObjectBindingPattern(node)) {
    for (const element of node.elements) if (ts.isBindingElement(element)) renameBindings(element.name, names);
  }
}
for (const statement of source.statements) {
  if (ts.isImportDeclaration(statement)) {
    for (const binding of statement.importClause.namedBindings.elements) {
      if (topNames[binding.name.text]) rename(binding.name, topNames[binding.name.text]);
    }
  } else if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) renameBindings(declaration.name, topNames);
  } else if (ts.isFunctionDeclaration(statement) && topNames[statement.name.text]) {
    rename(statement.name, topNames[statement.name.text]);
  }
}
const bindingsByFunction = {
  b: { e: "name" },
  x: { e: "location", n: "navigate", a: "query", o: "preview", u: "viewAsPlayerId", p: "athletePreview", h: "organizationId", y: "linkedPlayer", x: "activityId", C: "context", O: "setContext", k: "status", A: "setStatus", j: "error", M: "setError", N: "scope", P: "setScope", F: "panel", I: "setPanel", L: "activities", R: "setActivities", z: "cursor", B: "setCursor", V: "loading", H: "setLoading", U: "authRequest", W: "feedRequest", G: "loadFeed", K: "feedUrl", q: "athleteUrl", J: "staffOnly", Y: "tabs" },
  S: { e: "activity", t: "organizationId", n: "preview", r: "onChange", a: "onPerson", o: "viewAsPlayerId", d: "busy", m: "setBusy", h: "error", g: "setError", v: "commentsOpen", x: "setCommentsOpen", S: "videoUrl", w: "setVideoUrl", T: "videoNotice", E: "setVideoNotice", D: "reportReason", O: "setReportReason", k: "notice", A: "setNotice", j: "mounted", M: "viewerUid", N: "runAction", P: "refreshActivity", F: "chartMaximum" },
  C: { e: "activity", t: "organizationId", n: "preview", r: "onChanged", a: "viewAsPlayerId", o: "comments", s: "setComments", u: "cursor", d: "setCursor", f: "text", m: "setText", h: "error", g: "setError", v: "busy", y: "setBusy", b: "pendingCommentId", x: "mounted", S: "loadComments", C: "saveComment" },
  w: { e: "context", t: "linkedPlayer", n: "organizationId", r: "preview", a: "viewAsPlayerId", o: "people", s: "setPeople", u: "cursor", d: "setCursor", p: "search", m: "setSearch", h: "error", v: "setError", y: "busy", b: "setBusy", x: "notice", S: "setNotice", C: "mounted", w: "loadPeople", T: "changeConnection" },
  T: { e: "context", t: "organizationId", n: "preview", r: "onSave", a: "viewAsPlayerId", o: "preferences", s: "setPreferences", u: "busy", d: "setBusy", f: "notice", p: "setNotice" },
  E: { e: "organizationId", t: "viewAsPlayerId", n: "reports", a: "setReports", o: "error", s: "setError", u: "busy", d: "setBusy", f: "loadReports" },
  D: { e: "organizationId", n: "selectedPlayer", i: "onSwitch", a: "navigate", o: "directory", s: "setDirectory", u: "error", d: "setError", f: "switchPlayer" },
};
for (const statement of source.statements) {
  if (!ts.isFunctionDeclaration(statement)) continue;
  const names = bindingsByFunction[statement.name.text];
  if (!names) continue;
  for (const parameter of statement.parameters) renameBindings(parameter.name, names);
  for (const child of statement.body.statements) {
    if (ts.isVariableStatement(child)) for (const declaration of child.declarationList.declarations) renameBindings(declaration.name, names);
  }
}

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
      const names = ts.isArrayLiteralExpression(dependencies) ? dependencies.elements.map(element => element.text) : [];
      if (names.some(name => ["loadFeed", "loadPeople", "loadReports", "organizationId"].includes(name))) {
        ts.addSyntheticLeadingComment(statement, ts.SyntaxKind.MultiLineCommentTrivia, " oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. ", true);
        ts.addSyntheticTrailingComment(statement, ts.SyntaxKind.MultiLineCommentTrivia, " oxlint-enable react/set-state-in-effect ", true);
      }
      if ((names.includes("navigate") && names.includes("viewAsPlayerId")) || names.includes("loadFeed")) {
        ts.addSyntheticLeadingComment(statement, ts.SyntaxKind.MultiLineCommentTrivia, " oxlint-disable react-hooks/exhaustive-deps -- These refs are request counters, not DOM nodes; cleanup must invalidate their latest values. ", true);
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
      const declarations = node.declarationList.declarations.filter(declaration => !["c", "_", "u", "d", "f", "p"].includes(declaration.name.text));
      if (!declarations.length) return undefined;
      node = ts.factory.updateVariableStatement(node, node.modifiers, ts.factory.updateVariableDeclarationList(node.declarationList, declarations));
    }
    if (ts.isFunctionDeclaration(node) && node.name.text === "l") return undefined;
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
    if (ts.isArrowFunction(node) && ts.isParenthesizedExpression(node.body) && ts.isBinaryExpression(node.body.expression) && node.body.expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return ts.factory.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken,
        ts.factory.createBlock([...expressionStatements(node.body.expression.left), ts.factory.createReturnStatement(node.body.expression.right)], true));
    }
    if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return [...expressionStatements(node.expression.left), ts.factory.updateIfStatement(node, node.expression.right, node.thenStatement, node.elseStatement)];
    }
    if (ts.isExportSpecifier(node) && node.propertyName?.text === node.name.text) return ts.factory.updateExportSpecifier(node, node.isTypeOnly, undefined, node.name);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.text === "jsxRuntime" && ["jsx", "jsxs"].includes(node.expression.name.text)) {
      const [tag, props, key] = node.arguments;
      if (!ts.isObjectLiteralExpression(props)) throw new Error("Unexpected JSX props shape");
      const childValue = props.properties.find(property => property.name?.text === "children")?.initializer;
      const values = childValue ? ts.isArrayLiteralExpression(childValue) ? [...childValue.elements] : [childValue] : [];
      const children = values.length ? [ts.factory.createJsxText("\n"), ...values.flatMap(value => [ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value) ? value : ts.factory.createJsxExpression(undefined, value), ts.factory.createJsxText("\n")])] : [];
      if (ts.isPropertyAccessExpression(tag) && tag.name.text === "Fragment") return ts.factory.createJsxFragment(ts.factory.createJsxOpeningFragment(), children, ts.factory.createJsxJsxClosingFragment());
      const tagName = ts.isStringLiteralLike(tag) ? ts.factory.createIdentifier(tag.text) : tag;
      const attributes = props.properties.filter(property => property.name?.text !== "children").map(property => ts.factory.createJsxAttribute(ts.factory.createIdentifier(property.name.text), ts.factory.createJsxExpression(undefined, property.initializer)));
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
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { callSocial } from "./api";
import { formatMeasurement, mergeActivities, initials, formatDate } from "./model";
import "./feed.css";
import "../../styles/pose-portal.css";
import "./feed-cascade.css";
\n`;
const clearSourcePositions = node => { ts.setTextRange(node, { pos: -1, end: -1 }); ts.forEachChild(node, clearSourcePositions); };
clearSourcePositions(transformed.transformed[0]);
let recovered = header + ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]);
const recoveredPath = output + "FeedPage.jsx";
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

const css = readFileSync(new URL("FeedPage-IidU16n6.css", capture), "utf8");
if (digest(css) !== "1c186367afe64ff15227a5c06950195f1e8fbe1a62dbc2ec40e4fdde1715af1f") throw new Error("Feed stylesheet differs from the reviewed deployment");
let indent = 0;
const formatted = css.replace(/[{};]/g, token => {
  if (token === "{") { indent++; return " {\n" + "  ".repeat(indent); }
  if (token === "}") { indent--; return "\n" + "  ".repeat(indent) + "}\n" + "  ".repeat(indent); }
  return ";\n" + "  ".repeat(indent);
});
writeFileSync(output + "feed.css", formatted.replace(/[ \t]+$/gm, "").trim() + "\n");
console.log("Recovered FeedPage.jsx and feed.css from verified pinned public files.");
