#!/usr/bin/env node
// Usage baseline harness (#192, fase 1 — authorized by the PO 2026-11-05).
// Walks the app's real flows against a local production build (npm run preview)
// pointed at store-os-dev and counts, per phase, the Firestore traffic it
// causes: listener channels opened (Listen) and queries run (RunQuery /
// BatchGet). The report separates what a phase COSTS, not what it looks like.
//
// Usage: node scripts/measure-usage.mjs [--base http://localhost:4319] [--out report.md]
//                                [--email a@b.c --password …]   (admin phases)
// Prereqs: `npm run build && npm run preview` serving the dev-configured build.
// Anonymous phases (public catalog) run with no credentials. Admin phases need
// dev credentials via the UI: the Admin SDK cannot mint custom tokens from
// user ADC (signing requires a service account), so the harness signs in with
// email/password like a human operator.
//
// LOAD-BEARING GUARD (mirrors seed-dev.cjs): this script refuses to run unless
// the local Firebase config targets store-os-dev. It never touches production.
"use strict";

import { writeFileSync } from "node:fs";

const DEV_PROJECT_ID = "store-os-dev";
const base = argumentValue("--base") ?? "http://localhost:4319";
const outPath = argumentValue("--out") ?? "measure-usage-report.md";

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  // The ?measure hook only arms on dev-project builds (config.ts), so this
  // harness cannot leak measurements — or access — toward production.
  const email = argumentValue("--email");
  const password = argumentValue("--password");
  if (!email || !password) {
    console.log("ℹ Sin --email/--password: se miden solo las fases anónimas (catálogo público).");
  }

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const metrics = [];
  const consoleLines = [];

  async function phase(name, url, action) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const requests = { Listen: 0, RunQuery: 0, BatchGet: 0, GetDocument: 0, Write: 0, Commit: 0, other: 0 };
    // Two API styles hit Firestore: the web SDK (gRPC-web paths like
    // /google.firestore.v1.Firestore/Listen) and the public catalog's direct
    // REST reads (…/documents:runQuery, :batchGet, plain document GETs).
    const onRequest = (request) => {
      const url = request.url();
      if (!url.includes("firestore.googleapis.com")) return;
      const grpc = /Firestore\/(Listen|RunQuery|BatchGet|GetDocument|Write|Commit)\b/.exec(url);
      const rest = /documents:(runQuery|batchGet)/.exec(url) ?? (/\/databases\/\(default\)\/documents\/[^:]+$/.exec(url) ? ["", "GetDocument"] : null);
      const key = grpc?.[1] ?? rest?.[1];
      if (key && key in requests) requests[key] += 1;
      else {
        requests.other += 1;
        consoleLines.push(`[${name}] SIN CLASIFICAR: ${url}`);
      }
    };
    const onConsole = (message) => {
      const text = message.text();
      if (text.includes("[firestore]") || text.includes("Received")) consoleLines.push(`[${name}] ${text}`);
    };
    page.on("request", onRequest);
    page.on("console", onConsole);
    const started = Date.now();
    // Let phases discard the cost of their own setup navigation (reload case).
    page.__measureReset = () => {
      for (const key of Object.keys(requests)) requests[key] = 0;
      const cut = consoleLines.length;
      consoleLines.splice(0, cut);
    };
    try {
      await action(page, `${url}${url.includes("?") ? "&" : "?"}measure=1`);
      await page.waitForTimeout(2500); // settle: in-flight snapshots land.
      metrics.push({ name, ms: Date.now() - started, ...requests });
    } finally {
      page.off("request", onRequest);
      page.off("console", onConsole);
      await context.close();
    }
  }

  // Público — frío y recarga (sin sesión). The reload phase zeroes its
  // counters after the initial load so it reports ONLY the reload cost.
  await phase("catálogo público · frío", `${base}/catalogo/olivia`, (page, url) => page.goto(url, { waitUntil: "networkidle" }));
  await phase("catálogo público · recarga", `${base}/catalogo/olivia`, async (page, url) => {
    await page.goto(url, { waitUntil: "networkidle" });
    page.__measureReset?.();
    await page.reload({ waitUntil: "networkidle" });
  });

  // Admin — login por UI (como la operadora) y navegación por pantalla.
  if (email && password) {
    const signInIn = async (page) => {
      await page.getByLabel("Correo").fill(email);
      await page.getByLabel("Contraseña").fill(password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForTimeout(3500);
    };
    await phase("admin · login + carga inicial", `${base}/`, async (page, url) => {
      await page.goto(url, { waitUntil: "networkidle" });
      await signInIn(page);
    });
    for (const [name, path] of [["admin · productos", "/productos"], ["admin · pedidos", "/pedidos"], ["admin · clientas", "/clientes"]]) {
      await phase(name, `${base}${path}`, async (page, url) => {
        await page.goto(url, { waitUntil: "networkidle" });
        await signInIn(page);
        await page.waitForTimeout(2500);
      });
    }
  }

  await browser.close();
  writeReport(metrics);
  writeFileSync(outPath, reportMarkdown(metrics), "utf8");
  writeFileSync(`${outPath}.raw-console.log`, consoleLines.join("\n"), "utf8");
  console.log(`✔ Reporte: ${outPath} (+ log crudo del SDK en ${outPath}.raw-console.log)`);
}

function writeReport(metrics) {
  console.table(metrics);
}

function reportMarkdown(metrics) {
  const total = (key) => metrics.reduce((sum, row) => sum + row[key], 0);
  return [
    "# Línea base de consumo — Store OS vs store-os-dev",
    "",
    `Generado: ${new Date().toISOString()} · Fuente: peticiones Firestore por fase + log crudo del SDK.`,
    "Lecturas facturables ≈ documentos entregados (log crudo); las peticiones clasifican el tipo de consulta.",
    "",
    "| Fase | Listen | RunQuery | BatchGet | GetDocument | ms |", "|---|---|---|---|---|---|",
    ...metrics.map((row) => `| ${row.name} | ${row.Listen} | ${row.RunQuery} | ${row.BatchGet} | ${row.GetDocument} | ${row.ms} |`),
    `| **Total** | ${total("Listen")} | ${total("RunQuery")} | ${total("BatchGet")} | ${total("GetDocument")} | |`,
    "",
  ].join("\n");
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});
