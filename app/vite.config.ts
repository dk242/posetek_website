import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build straight into the repo-root dist/ — Netlify and Firebase Hosting both
// publish that directory. scripts/copy-legacy.mjs then adds the unported
// legacy pages alongside the SPA bundle.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
