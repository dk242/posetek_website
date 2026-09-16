/**
 * One-time, reproducible recovery of the user's approved deployed demo components.
 * Run from this repository: node app/src/pages/home/product/recover-components.mjs
 * Original authored TSX is unavailable. Keep the emitted component logic intact;
 * dependency implementations are replaced by the project's existing dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../../../../node_modules/typescript/lib/typescript.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const reference = path.join(root, ".netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/marketing/assets");
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function readableStatements(source, filename) {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const transformed = ts.transform(parsed, [context => {
    const statements = expression => {
      if (ts.isParenthesizedExpression(expression)) return statements(expression.expression);
      if (ts.isBinaryExpression(expression)) {
        if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken)
          return [...statements(expression.left), ...statements(expression.right)];
        if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
          return [ts.factory.createIfStatement(expression.left, ts.factory.createBlock(statements(expression.right), true))];
        if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
          return [ts.factory.createIfStatement(ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken,
            ts.factory.createParenthesizedExpression(expression.left)), ts.factory.createBlock(statements(expression.right), true))];
      }
      if (ts.isConditionalExpression(expression))
        return [ts.factory.createIfStatement(expression.condition,
          ts.factory.createBlock(statements(expression.whenTrue), true),
          ts.factory.createBlock(statements(expression.whenFalse), true))];
      return [ts.factory.createExpressionStatement(expression)];
    };
    const visit = node => {
      const next = ts.visitEachChild(node, visit, context);
      if (ts.isImportSpecifier(next) && next.propertyName?.text === next.name.text)
        return ts.factory.updateImportSpecifier(next, next.isTypeOnly, undefined, next.name);
      if (ts.isBindingElement(next) && next.propertyName?.text === next.name.text)
        return ts.factory.updateBindingElement(next, next.dotDotDotToken, undefined, next.name, next.initializer);
      if (ts.isExpressionStatement(next)) return statements(next.expression);
      if (ts.isVariableStatement(next) && next.declarationList.declarations.length > 1)
        return next.declarationList.declarations.map(declaration => ts.factory.createVariableStatement(next.modifiers,
          ts.factory.createVariableDeclarationList([declaration], next.declarationList.flags)));
      if (ts.isPrefixUnaryExpression(next) && next.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(next.operand)) {
        if (next.operand.text === "0") return ts.factory.createTrue();
        if (next.operand.text === "1") return ts.factory.createFalse();
      }
      return next;
    };
    return node => ts.visitNode(node, visit);
  }]);
  const result = printer.printFile(transformed.transformed[0]);
  transformed.dispose();
  return result;
}

function recover({ input, output, functions, functionNames, imports, names, exportNames }) {
  const original = fs.readFileSync(path.join(reference, input), "utf8");
  const parsed = ts.createSourceFile(input, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const selected = parsed.statements.filter(statement =>
    ts.isFunctionDeclaration(statement) && functions.includes(statement.name.text));
  if (selected.length !== functions.length) throw new Error(`Missing component functions in ${input}`);
  const source = imports + "\n" + selected.map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, parsed)).join("\n");
  const virtualFile = path.join(directory, output);
  const compilerHost = ts.createCompilerHost({ allowJs: true, noResolve: true });
  compilerHost.getSourceFile = (file, languageVersion) => path.resolve(file).toLowerCase() === virtualFile.toLowerCase()
    ? ts.createSourceFile(file, source, languageVersion, true, ts.ScriptKind.JS) : undefined;
  const program = ts.createProgram([virtualFile], { allowJs: true, noResolve: true }, compilerHost);
  const file = program.getSourceFile(virtualFile);
  const checker = program.getTypeChecker();
  const renames = new Map();

  // Use bound symbols, not text replacement, so nested iterator/local names keep
  // their meaning even when the minifier reused a component-level identifier.
  function collect(node, scope = "module") {
    if (ts.isFunctionDeclaration(node)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (functionNames[node.name.text]) renames.set(symbol, functionNames[node.name.text]);
      ts.forEachChild(node, child => child !== node.name && collect(child, node.name.text));
      return;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) scope = "nested";
    if (ts.isIdentifier(node) && names[scope]?.[node.text]) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol && symbol.declarations?.some(declaration =>
        (ts.isVariableDeclaration(declaration) || ts.isBindingElement(declaration) ||
         ts.isParameter(declaration) || ts.isNamespaceImport(declaration) || ts.isImportSpecifier(declaration)) &&
        declaration.name === node)) {
        renames.set(symbol, names[scope][node.text]);
      }
    }
    ts.forEachChild(node, child => collect(child, scope));
  }
  collect(file);
  const transformed = ts.transform(file, [context => {
    const visit = node => {
      if (ts.isIdentifier(node)) {
        const name = renames.get(checker.getSymbolAtLocation(node));
        if (name) return ts.factory.createIdentifier(name);
      }
      const visited = ts.visitEachChild(node, visit, context);
      // The standalone long page needs the user-requested next heading below
      // its sticky navigation. Preserve the existing user-intent guard.
      if (output === "WorkoutDemo.js" && ts.isCallExpression(visited) &&
          ts.isPropertyAccessExpression(visited.expression) && visited.expression.name.text === "focus")
        return ts.factory.createCallExpression(ts.factory.createIdentifier("focusWorkoutHeading"), undefined,
          [ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("containerRef"), "current")]);
      if (ts.isObjectLiteralExpression(visited)) return ts.factory.createObjectLiteralExpression(visited.properties, true);
      if (ts.isArrayLiteralExpression(visited) && ts.isPropertyAssignment(node.parent) && node.parent.name?.getText(file) === "children")
        return ts.factory.createArrayLiteralExpression(visited.elements, true);
      if (ts.isBlock(visited)) return ts.factory.createBlock(visited.statements, true);
      return visited;
    };
    return node => ts.visitNode(node, visit);
  }]);
  const header = `/**\n * Recovered from ${input}, deployment 6aa9b6f0d8faf6177db8fd97.\n * See RECOVERY.md. JSX-runtime calls preserve the published element tree.\n */\n`;
  let recovered = printer.printFile(transformed.transformed[0]);
  if (output === "WorkoutDemo.js") {
    recovered = recovered
      .replace("initialRequest: initialRequest = `` })", "initialRequest: initialRequest = ``, requestId = 0 })")
      .replace("previousRequestRef = (0, React.useRef)(initialRequest)", "previousRequestRef = (0, React.useRef)({ text: initialRequest, id: requestId })")
      .replace("initialRequest === previousRequestRef.current", "(initialRequest === previousRequestRef.current.text && requestId === previousRequestRef.current.id)")
      .replace("previousRequestRef.current = initialRequest", "previousRequestRef.current = { text: initialRequest, id: requestId }")
      .replace("[initialRequest])", "[initialRequest, requestId])");
  }
  fs.writeFileSync(virtualFile, header + readableStatements(recovered, output) + "\n" + exportNames + "\n");
  transformed.dispose();
}

recover({
  input: "WorkoutDemo-cLuzxzv9.js", output: "WorkoutDemo.js",
  functions: ["bt", "xt", "St"],
  functionNames: { bt: "DemoPitch", xt: "CheckIcon", St: "WorkoutDemo" },
  imports: `import * as E from "react";
import * as Q from "react/jsx-runtime";
import { MagicCard as yt } from "../../../components/magicui/magic-card";
import { BlurFade as f } from "../../../components/magicui/blur-fade";
import { TacticalIcon as u } from "../TacticalIcon";
import { formatDuration as _, workoutReducer as v, formatDose as y, initialWorkoutState as b, focusFromRequest as x } from "./product-demo";
import { focusWorkoutHeading } from "./workout-focus";
import "./product-demo.css";
import "./workout-section.css";`,
  names: {
    module: { E: "React", Q: "jsxRuntime", yt: "MagicCard", f: "BlurFade", u: "TacticalIcon", _: "formatDuration", v: "workoutReducer", y: "formatDose", b: "initialWorkoutState", x: "focusFromRequest" },
    bt: { e: "focus", t: "className" },
    St: { e: "active", t: "initialRequest", n: "choices", r: "setChoices", i: "choosingFocus", a: "setChoosingFocus", o: "preparationStep", s: "setPreparationStep", c: "state", l: "dispatch", d: "inView", p: "setInView", m: "documentVisible", h: "setDocumentVisible", g: "containerRef", S: "shouldFocusRef", C: "previousRequestRef", w: "headingId", T: "workout", D: "currentSegment", O: "currentDrill", k: "totalSets", A: "stepLabels", j: "activeStep", M: "focus", N: "updateChoice", P: "transition", F: "setFocusStep" },
  },
  exportNames: "export { DemoPitch, WorkoutDemo as default };",
});

recover({
  input: "CoachDemo-B4XwZJSc.js", output: "CoachDemo.js", functions: ["u"],
  functionNames: { u: "CoachDemo" },
  imports: `import * as c from "react";
import * as l from "react/jsx-runtime";
import { BlurFade as r } from "../../../components/magicui/blur-fade";
import { TacticalIcon as n } from "../TacticalIcon";
import { sampleAthlete as a, coachWorkoutRequest as o, coachQuestions as s } from "./product-demo";
import "./product-demo.css";`,
  names: {
    module: { c: "React", l: "jsxRuntime", r: "BlurFade", n: "TacticalIcon", a: "sampleAthlete", o: "coachWorkoutRequest", s: "coachQuestions" },
    u: { u: "setSelectedQuestion", e: "active", t: "onOpenWorkout", i: "selectedQuestion", d: "visibleWords", f: "setVisibleWords", p: "hasInteracted", m: "setHasInteracted", h: "documentVisible", g: "setDocumentVisible", _: "headingId", v: "question", y: "answerWords" },
  },
  exportNames: "export default CoachDemo;",
});

// Preserve the deployed cascade/rule order. Formatting only: no selector/value edits.
const css = fs.readFileSync(path.join(reference, "product-demo-BXeuUJ-U.css"), "utf8");
fs.writeFileSync(path.join(directory, "product-demo.css"),
  "/* Recovered verbatim rules from product-demo-BXeuUJ-U.css; see RECOVERY.md. */\n" +
  css.replaceAll("}", "}\n").replaceAll(";", ";\n  ").replaceAll("{", " {\n  ") + "\n");
