import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  base: "/marketing/",
  publicDir: false,
  plugins: [react(), svelte({ configFile: false }), tailwindcss()],
  build: {
    outDir: "marketing-dist",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
