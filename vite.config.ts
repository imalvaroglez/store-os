import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
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
      // Preview deployments must never be indexed. VITE_VERCEL_ENV is set by
      // the deploy job (and validated by scripts/check-env.cjs); production
      // builds don't set it to "preview", so they stay indexable.
      const noindex =
        process.env.VITE_VERCEL_ENV === "preview"
          ? `<meta name="robots" content="noindex, nofollow">`
          : "";
      return html.replace(/<head>/i, `<head><meta name="x-build" content="${sha}">${noindex}`);
    },
  };
}

// Mirror vercel.json's /catalogo/* rewrite in dev and preview so the PUBLIC
// entry (not the admin SPA fallback) serves storefront URLs locally. Without
// this, local runs and the e2e suites would silently test the admin bundle
// and report false confidence on the public critical path.
function publicEntryRewrite(): Plugin {
  const rewrite = (middlewares: Connect.Server) => {
    middlewares.use((req, _res, next) => {
      const pathname = (req.url ?? "").split("?")[0];
      if (!/^\/catalogo\/[^/]+/.test(pathname)) {
        next();
        return;
      }
      // Prerendered pages (scripts/prerender-public.mjs) win over the SPA
      // shell in preview, exactly like Vercel's filesystem-over-rewrite rule.
      const staticPath = pathname.endsWith("/")
        ? `${pathname}index.html`
        : `${pathname}/index.html`;
      if (existsSync(resolve(__dirname, "dist", `.${staticPath}`))) {
        req.url = staticPath;
      } else {
        req.url = "/public.html";
      }
      next();
    });
  };
  return {
    name: "store-os-public-entry",
    configureServer(server) {
      rewrite(server.middlewares);
    },
    configurePreviewServer(server) {
      rewrite(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), buildMarker(), publicEntryRewrite()],
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), public: resolve(__dirname, "public.html") } } },
  // SPA: every unknown route falls back to index.html so client-side routes
  // (/catalogo-admin, /pedidos, /catalogo/:slug) resolve on hard reload / preview / static hosts.
  appType: "spa",
  server: {
    port: 5173,
  },
  preview: {
    port: 4319,
    // Cloudflare quick tunnels (cloudflared tunnel --url) get a random
    // <name>.trycloudflare.com host per run; allow the whole domain.
    allowedHosts: [".trycloudflare.com"],
  },
});
