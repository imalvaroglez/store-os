import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
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
