#!/usr/bin/env node
/** Deploy the current Firebase structure and callable to development only. */
"use strict";

const { spawnSync } = require("node:child_process");

const projectId = "store-os-dev";
const result = spawnSync(
  "firebase",
  [
    "deploy",
    "--only",
    "firestore:rules,firestore:indexes,storage,functions",
    "--project",
    projectId,
  ],
  { stdio: "inherit" }
);

if (result.error) {
  console.error("No se encontró Firebase CLI. Instálalo antes de desplegar a store-os-dev.");
  process.exit(1);
}
process.exit(result.status ?? 1);
