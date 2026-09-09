// Both the personalized planner and kick tools now build from the merged source.
// Keep this entry point for callers of the former composed-production builder.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", "app", "run", "build"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
