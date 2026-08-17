import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// Injects the building commit's short SHA into every HTML entry. The A→B stale
// repro (scripts/repro-stale.mjs) and the refresh-hard-reload previewCheck read
// this meta to know WHICH deploy was served — the direct evidence the spec requires.
function buildMarker(): Plugin {
  let sha = "dev";
  if (process.env.NODE_ENV === "production") {
    try {
      sha = execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      sha = "unknown";
    }
  }
  return {
    name: "store-os-build-marker",
    transformIndexHtml(html) {
      return html.replace(/<head>/i, `<head><meta name="x-build" content="${sha}">`);
    },
  };
}

export default defineConfig({
  plugins: [react(), buildMarker()],
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), olivia: resolve(__dirname, "olivia.html") } } },
  // SPA: every unknown route falls back to index.html so client-side routes
  // (/catalogo-admin, /pedidos, /catalogo/:slug) resolve on hard reload / preview / static hosts.
  appType: "spa",
  server: {
    port: 5173,
  },
  preview: {
    port: 4319,
  },
});
