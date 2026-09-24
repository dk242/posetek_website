import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = path.resolve(appDirectory, "..");
const labelArgument = process.argv.find(argument => argument.startsWith("--label="))?.slice(8) || "current";
const label = labelArgument.replace(/[^a-z0-9_-]/gi, "-");
const outputDirectory = path.join(repositoryDirectory, "artifacts", "admin-dashboard", label);
const origin = "http://127.0.0.1:4175";
const viewports = [
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "tablet-1024", width: 1024, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the Vite preview server.");
}

await mkdir(outputDirectory, { recursive: true });
const viteExecutable = path.join(appDirectory, "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteExecutable, "--host", "127.0.0.1", "--port", "4175"], {
  cwd: appDirectory,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput += String(chunk); });
server.stderr.on("data", chunk => { serverOutput += String(chunk); });

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/admin?preview=1`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outputDirectory, `${viewport.name}.png`), fullPage: true });
    await page.close();
  }
  process.stdout.write(`Saved admin screenshots to ${outputDirectory}\n`);
} catch (error) {
  if (serverOutput) process.stderr.write(serverOutput);
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill();
}
