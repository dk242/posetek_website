/** Optional provenance check; requires the ignored, pinned deployed capture. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "../../../../node_modules/typescript/lib/typescript.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const reference = path.resolve(directory, "../../../../../.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/marketing/assets");
const hashes = {
  "WorkoutDemo-cLuzxzv9.js": "2a207353bca40aeb202504ad77b853829ba61d7c9618f0d951f197283c0bdc25",
  "CoachDemo-B4XwZJSc.js": "1f7f8d7738743530bfd222982d2fcd598d7448028deb6de8becb66956df5fe28",
  "product-demo-fcPr5ZHv.js": "7747f329e3082ac4010b512c28200b9ac7bf2e3816cc86493239d74d94c80c71",
  "product-demo-BXeuUJ-U.css": "7156489a86897bd6c344d689ed8cdce4b057a7c6560135556826cc5a469acf9c",
};
for (const [name, checksum] of Object.entries(hashes)) {
  assert.equal(createHash("sha256").update(fs.readFileSync(path.join(reference, name))).digest("hex"), checksum, name);
}
const loadSource = source => import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const deployed = await loadSource(fs.readFileSync(path.join(reference, "product-demo-fcPr5ZHv.js"), "utf8"));
const local = await loadSource(ts.transpileModule(fs.readFileSync(path.join(directory, "product-demo.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
}).outputText);

assert.deepEqual(local.sampleAthlete, deployed.i);
assert.deepEqual(local.coachQuestions, deployed.t);
assert.equal(local.coachWorkoutRequest, deployed.n);
assert.deepEqual(local.initialWorkoutState, deployed.r);
let transitions = 0;
let plans = 0;
for (const minutes of [15, 20, 30, 45, 60]) {
  for (const energy of ["low", "normal", "high"]) {
    for (const focus of ["dribbling", "passing", "shooting"]) {
      let actual = local.initialWorkoutState;
      let expected = deployed.r;
      const apply = action => {
        actual = local.workoutReducer(actual, action);
        expected = deployed.c(expected, action);
        assert.deepEqual(actual, expected, JSON.stringify({ minutes, energy, focus, action }));
        transitions++;
      };
      apply({ type: "prepare", choices: { minutes, energy, focus } });
      plans++;
      assert.deepEqual(local.createDemoWorkout({ minutes, energy, focus }), expected.workout);
      for (const drill of actual.workout.drills) assert.equal(local.formatDose(drill), deployed.o(drill));
      apply({ type: "ready" });
      apply({ type: "start" });
      apply({ type: "pause" });
      apply({ type: "tick", seconds: 5 });
      apply({ type: "pause" });
      for (const seconds of [0.25, 0, -1, Infinity, NaN]) apply({ type: "tick", seconds });
      let safety = 0;
      while (actual.step === "training" && safety++ < 100) {
        const kind = actual.workout.segments[actual.segment].kind;
        apply({ type: "tick", seconds: actual.remaining + 2 });
        if (kind === "work") apply({ type: "advance" });
      }
      assert.equal(actual.step, "summary");
      apply({ type: "reset" });
      apply({ type: "prepare", choices: { minutes, energy, focus } });
      apply({ type: "ready" });
      apply({ type: "start" });
      apply({ type: "tick", seconds: 1.5 });
      apply({ type: "advance" });
      apply({ type: "finishDemo" });
      apply({ type: "edit" });
    }
  }
}
for (const seconds of [-1, 0, .1, 59.75, 60, 3600]) assert.equal(local.formatDuration(seconds), deployed.a(seconds));
for (const request of ["", "kick", "receive a pass", local.coachWorkoutRequest]) assert.equal(local.focusFromRequest(request), deployed.s(request));

// The stylesheet differs only in formatting and its provenance comment.
const originalCss = fs.readFileSync(path.join(reference, "product-demo-BXeuUJ-U.css"), "utf8");
const localCss = fs.readFileSync(path.join(directory, "product-demo.css"), "utf8").replace(/^\/\*[\s\S]*?\*\/\s*/, "");
const expectedCss = originalCss.replaceAll("}", "}\n").replaceAll(";", ";\n  ").replaceAll("{", " {\n  ") + "\n";
assert.equal(localCss, expectedCss);
console.log(`Verified four source checksums, ${plans} published dose combinations, ${transitions} reducer transitions, sample coach data, formatting, and unchanged CSS rules.`);
