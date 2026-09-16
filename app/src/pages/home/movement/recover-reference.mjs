/** One-time reproducible extraction from PoseTek's accepted public deployment.
 * Run from the repository root: node app/src/pages/home/movement/recover-reference.mjs
 * The immutable capture must exist locally; it is never imported at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from '../../../../node_modules/typescript/lib/typescript.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const capture = path.join(root, '.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/marketing/assets');
const asset = name => fs.readFileSync(path.join(capture, name), 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const movementName = 'PoseDemo-oa1MzmqS.js';
const source = parse(movementName, asset(movementName));
const dataStatement = source.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations[0].name.getText(source) === 'j');
const dataDeclaration = dataStatement.declarationList.declarations[0];
// This expression is a literal object from our pinned, reviewed public bundle.
const data = vm.runInNewContext(`(${dataDeclaration.initializer.getText(source)})`, Object.create(null));
fs.writeFileSync(path.join(here, 'recorded-movement.json'), JSON.stringify(data) + '\n');
const imports = `import * as i from 'react';\nimport * as M from 'react/jsx-runtime';\nimport { TacticalIcon as n } from '../TacticalIcon';\nimport j from './recorded-movement.json';\n`;
const statements = source.statements.filter(s => !ts.isImportDeclaration(s) && s !== dataStatement && !s.getText(source).startsWith('var i='));
const remainingDataDeclarations = dataStatement.declarationList.declarations.filter(d => !['j', 'M'].includes(d.name.getText(source)));
const insertion = ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList(remainingDataDeclarations, ts.NodeFlags.Const));
const componentIndex = statements.findIndex(s => ts.isFunctionDeclaration(s) && s.name.text === 'H');
statements.splice(componentIndex, 0, insertion);
let recovered = imports + statements.map(s => printer.printNode(ts.EmitHint.Unspecified, s, source)).join('\n') + '\n';
// Resolve symbols before renaming: local minifier names must never be changed.
const filename = path.join(here, 'RecoveredMovement.js');
const host = ts.createCompilerHost({ allowJs: true });
const defaultSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (name, version, ...rest) => path.resolve(name) === filename ? parse(name, recovered) : defaultSourceFile(name, version, ...rest);
const program = ts.createProgram([filename], { allowJs: true, noResolve: true }, host);
const file = program.getSourceFile(filename), checker = program.getTypeChecker();
const renames = { i: 'React', M: 'jsxRuntime', n: 'TacticalIcon', j: 'recordedMovement', a: 'measurementForFrame', o: 'projectCalibrationPoint', s: 'calibrationGridLines', c: 'DEFAULT_VIEWPORT', l: 'BODY_EDGES', u: 'isPoseData', d: 'formatTime', f: 'fitViewport', p: 'canvasSize', m: 'screenPoint', h: 'landmark', g: 'hipCenter', _: 'markerFrame', v: 'directionPhase', y: 'jumpPhase', b: 'phaseForFrame', x: 'directionSegments', S: 'trailWindow', ee: 'overlayLabelY', C: 'lastFrame', w: 'secondsAtFrame', T: 'durationSeconds', E: 'timerText', D: 'phaseLabel', te: 'scrubberLabel', ne: 'wrapIndex', re: 'restingFrame', O: 'clampFrame', ie: 'elapsedTime', ae: 'advanceFrame', k: 'createMovementController', A: 'useMovementPlayback', H: 'PoseDemo', N: 'movementData', P: 'initialSequence', F: 'initialPhase', I: 'initialFps', L: 'initialTimer', R: 'initialPhaseLabel', z: 'initialMeasurement', B: 'drillLabels', V: 'drillOptions' };
const symbols = new Map();
function topName(node) { if (node && ts.isIdentifier(node) && renames[node.text]) symbols.set(checker.getSymbolAtLocation(node), renames[node.text]); }
for (const statement of file.statements) {
  if (ts.isFunctionDeclaration(statement)) topName(statement.name);
  if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach(d => topName(d.name));
  if (ts.isImportDeclaration(statement)) {
    topName(statement.importClause?.name);
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) topName(bindings.name);
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach(e => topName(e.name));
  }
}
const transformed = ts.transform(file, [context => rootNode => {
  function visit(node) {
    if (ts.isIdentifier(node)) {
      const renamed = symbols.get(checker.getSymbolAtLocation(node));
      if (renamed) return ts.factory.createIdentifier(renamed);
    }
    return ts.visitEachChild(node, visit, context);
  }
  return ts.visitNode(rootNode, visit);
}]);
recovered = printer.printFile(transformed.transformed[0]);
transformed.dispose();
recovered = recovered.replace(/export \{ H as PoseDemo \};/, 'export { PoseDemo };');
recovered += '\nexport { createMovementController, measurementForFrame, calibrationGridLines };\n';
const header = '// Recovered from the accepted 2026-09-15 deployment; see PROVENANCE.md.\n// Rendering and playback logic are preserved. Shared React is imported from npm.\n';
fs.writeFileSync(filename, header + recovered);
const cssName = 'PoseDemo-CqGXJyR9.css';
fs.writeFileSync(path.join(here, 'movement.css'), '/* Accepted 2026-09-15 movement demo styling. */\n' + asset(cssName));

const mainName = 'index-B_aLIfan.js', main = parse(mainName, asset(mainName));
const poseDeclaration = main.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(main) === 'Iu');
const pose = vm.runInNewContext(`(${poseDeclaration.initializer.getText(main)})`, Object.create(null));
const hero = path.join(here, '../latest-hero');
fs.mkdirSync(hero, { recursive: true });
fs.writeFileSync(path.join(hero, 'shooting-pose.json'), JSON.stringify(pose, null, 2) + '\n');
const provenance = {
  deployment: '6aa9b6f0d8faf6177db8fd97',
  assets: Object.fromEntries([movementName, cssName, mainName, 'mount-B0YcjNhI.js'].map(name => [name, sha(asset(name))])),
  movementDataSha256: sha(JSON.stringify(data)),
  reconstructedPoseSha256: sha(JSON.stringify(pose)),
  sequences: data.sequences.map(s => ({ key: s.key, frames: s.frames.length, fps: s.fps ?? data.fps, calibratedMarkers: s.calibration?.markers.length ?? 0, telemetrySamples: s.telemetry?.speed?.metersPerSecond.length ?? 0 })),
};
fs.writeFileSync(path.join(here, 'reference-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify(provenance, null, 2));
