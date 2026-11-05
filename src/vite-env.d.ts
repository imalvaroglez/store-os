/// <reference types="vite/client" />

// Build-time identity injected via vite.config.ts `define` (#179). Undefined
// under vitest (no define pass) — consumers must guard with typeof.
declare const __BUILD_SHA__: string | undefined;
declare const __BUILD_DATE__: string | undefined;
