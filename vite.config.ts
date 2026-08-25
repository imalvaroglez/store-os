import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// Injects the building commit's short SHA into every HTML entry. The A→B stale
// repro (scripts/repro-stale.mjs) and the refresh-hard-reload previewCheck read
// this meta to know WHICH deploy was served — the direct evidence the spec requires.
function buildMarker(): Plugin {
  // STORE_OS_BUILD_SHA overrides the git SHA so the refresh e2e can fabricate
  // two distinct "deploys" (A/B) from one working tree without fake commits.
  let sha = process.env.STORE_OS_BUILD_SHA?.trim() || "";
  if (!sha && process.env.NODE_ENV === "production") {
    try {
      sha = execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      sha = "unknown";
    }
  }
  if (!sha) sha = "dev";
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
    // Expose on the LAN so phones on the same Wi-Fi can open the public
    // catalog (http://<ip>:5173/catalogo/:slug). Firebase Auth still only
    // accepts localhost for sign-in — anonymous routes are the use case.
    host: true,
  },
  preview: {
    port: 4319,
  },
});
