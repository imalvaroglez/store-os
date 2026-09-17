#!/usr/bin/env node
// Fails the build if the PUBLIC entry chunk drags the Firebase SDK or balloons.
// The public path reads Firestore over REST; any SDK marker here means a
// shared module silently re-imported firebase/* into the storefront entry.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const assetsDir = join(process.cwd(), "dist", "assets");
const FORBIDDEN_MARKERS = [
  "initializeApp",
  "identitytoolkit", // firebase/auth
  "WebChannel", // firebase/firestore transport
  "firebasestorage.googleapis.com", // firebase/storage uploads
];
// Entry + lazy storefront chunks. Raw budget ~260 KB ≈ 65 KB gzip (react-dom
// + storefront + REST reader). Raise only with a measured reason.
const BUDGET_BYTES = 260_000;

const chunks = readdirSync(assetsDir).filter(
  (name) => name.endsWith(".js") && !name.startsWith("main-"),
);

let failed = false;
if (!readdirSync(assetsDir).some((name) => name.startsWith("public"))) {
  console.error(`✖ check-public-bundle: no public entry chunk found in dist/assets`);
  process.exit(1);
}
for (const name of chunks) {
  const source = readFileSync(join(assetsDir, name), "utf8");
  for (const marker of FORBIDDEN_MARKERS) {
    if (source.includes(marker)) {
      console.error(`✖ check-public-bundle: "${name}" contains Firebase SDK marker "${marker}"`);
      failed = true;
    }
  }
}
// Budget on the chunks a storefront visit actually loads (public entry + its
// shared/runtime graph), not on admin-only chunks.
for (const name of readdirSync(assetsDir)) {
  if (!name.endsWith(".js")) continue;
  if (!/^(public-|OliviaStorefront-|CartDrawer-|PublicCatalogScreen-|ErrorBoundary-|whatsapp-|oliviaContent-|Card-)/.test(name)) continue;
  const size = readFileSync(join(assetsDir, name)).length;
  if (size > BUDGET_BYTES) {
    console.error(`✖ check-public-bundle: "${name}" is ${size} B (> ${BUDGET_BYTES} B budget)`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`✔ public bundle clean (${chunks.length} non-admin chunks checked, no SDK markers)`);
