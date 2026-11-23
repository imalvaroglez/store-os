#!/usr/bin/env node
// Usage baseline harness (#192, fase 1 — authorized by the PO 2026-11-05).
// Walks the app's real flows against a LOCAL production build (npm run preview)
// pointed at store-os-dev and counts, per phase, the Firestore traffic it
// causes: listener channels opened (Listen) and queries run (RunQuery /
// BatchGet / GetDocument). The report separates what a phase COSTS, not what
// it looks like.
//
// Usage: node scripts/measure-usage.mjs [--base http://localhost:4319] [--out report.md]
//                                [--email a@b.c --password …]   (admin phases)
//                                [--emulator http://127.0.0.1:8080]  (classifier origin)
//                                [--product "Anillo"] [--client "Luc"]  (write-phase fixture)
// Prereqs: `npm run build && npm run preview` serving the dev-configured build.
// Anonymous phases (public catalog) run with no credentials. Admin phases need
// dev credentials via the UI: the Admin SDK cannot mint custom tokens from
// user ADC (signing requires a service account), so the harness signs in with
// email/password like a human operator.
//
// LOAD-BEARING GUARD (review #201 F1): two REAL checks keep this away from
// production, not a comment — (1) --base must be a loopback origin, and
// (2) before any phase runs, the served build must arm the dev-only measure
// hook (?measure=1 → window.__storeOsMeasure, which exists exclusively in
// store-os-dev builds; production builds dead-code it away). If either check
// fails the harness aborts without driving a single page.
"use strict";

import { writeFileSync } from "node:fs";

const base = argumentValue("--base") ?? "http://localhost:4319";
const outPath = argumentValue("--out") ?? "measure-usage-report.md";
// #192 QA: the classifier origin must match the emulator the BUILD points at
// (parallel emulator instances use other ports) — a wrong origin used to
// classify EVERYTHING as zero, silently.
const emulatorOrigin = argumentValue("--emulator") ?? "http://127.0.0.1:8080";
const fixtureProduct = argumentValue("--product") ?? "Anillo";
const fixtureClient = argumentValue("--client") ?? "Luc";

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function assertLoopbackBase() {
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    failWith(`--base "${base}" no es una URL válida.`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  if (!["http:", "https:"].includes(parsed.protocol) || !loopback.includes(parsed.hostname)) {
    failWith(`--base solo acepta orígenes locales (${loopback.join(", ")}); recibí "${base}". Este harness mide un build local y nunca apunta a un despliegue.`);
  }
}

function failWith(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  assertLoopbackBase();
  const email = argumentValue("--email");
  const password = argumentValue("--password");
  if (!email || !password) {
    console.log("ℹ Sin --email/--password: se miden solo las fases anónimas (catálogo público).");
  }

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const metrics = [];
  const phaseLogs = new Map(); // per-phase raw SDK lines — evidence survives every later phase.
  try {
    // Guard #2: the served build must be a measurable DEV build. The hook is
    // compiled out of production builds, so its absence means we are NOT
    // looking at a dev artifact — abort before measuring anything.
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${base}/?measure=1`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const armed = await page.evaluate(() => Boolean((window).__storeOsMeasure));
      await context.close();
      if (!armed) {
        // Throw (not failWith) so the finally below closes the browser (#192 F4).
        throw new Error("El build servido no arma el gancho de medición (window.__storeOsMeasure ausente). Solo los builds del proyecto store-os-dev lo incluyen; revisa que `npm run preview` sirva el build con la configuración de dev.");
      }
      console.log("✔ Build de medición verificado (gancho dev presente).");
    }

    async function phase(name, url, action) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const requests = { Listen: 0, RunQuery: 0, BatchGet: 0, GetDocument: 0, Write: 0, Commit: 0, other: 0 };
      const lines = [];
      phaseLogs.set(name, lines);
      // Two API styles hit Firestore: the web SDK (gRPC-web paths like
      // /google.firestore.v1.Firestore/Listen) and the public catalog's direct
      // REST reads (…/documents:runQuery, :batchGet, plain document GETs).
      const onRequest = (request) => {
        const requestUrl = request.url();
        // Dev-cloud (firestore.googleapis.com) OR the local emulator harness
        // (#192 fase 2: the same flows measured against 127.0.0.1:8080 — the
        // request SHAPES are identical, which is what the counters classify).
        const emulatorHost = new URL(emulatorOrigin).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`firestore\\.googleapis\\.com|${emulatorHost}`).test(requestUrl)) return;
        const grpc = /Firestore\/(Listen|RunQuery|BatchGet|GetDocument|Write|Commit)\b/.exec(requestUrl);
        // REST captures arrive lowercase; the counters speak camelCase (#192 F1).
        const restRaw = /documents:(runQuery|batchGet|commit)/.exec(requestUrl)?.[1]
          // #192 QA: plain document GETs may carry query strings — classify on
          // the path alone instead of anchoring the whole URL.
          ?? (/\/databases\/\(default\)\/documents\/[^:]+$/.test(requestUrl.split("?")[0]) ? "GetDocument" : null);
        const key = grpc?.[1] ?? (restRaw ? restRaw[0].toUpperCase() + restRaw.slice(1) : null);
        if (key && key in requests) requests[key] += 1;
        else {
          requests.other += 1;
          lines.push(`SIN CLASIFICAR: ${requestUrl}`);
        }
      };
      const onConsole = (message) => {
        const text = message.text();
        // #192 QA: the pinned SDK (12.15.0) prefixes console lines with the
        // "@firebase/firestore: Firestore (x.y.z):" banner — the old filter
        // matched none of it and the raw evidence log came out empty.
        if (/\[firestore\]|@firebase\/firestore:|Received \d+ (document|results|queries)/.test(text)) lines.push(text);
      };
      page.on("request", onRequest);
      page.on("console", onConsole);
      const started = Date.now();
      // Reload phase support: discard the setup navigation's cost (counters AND
      // this phase's own lines) without touching any other phase's evidence.
      page.__measureReset = () => {
        for (const key of Object.keys(requests)) requests[key] = 0;
        lines.length = 0;
      };
      try {
        await action(page, `${url}${url.includes("?") ? "&" : "?"}measure=1`);
        await page.waitForTimeout(2500); // settle: in-flight snapshots land.
        // #192 QA (MAYOR): never report a silent zero row — a phase that ran
        // to completion but classified ZERO requests means the classifier
        // origin is wrong (use --emulator) or the page never reached
        // Firestore. That is a failed measurement, loudly said.
        const total = Object.values(requests).reduce((sum, n) => sum + n, 0);
        if (total === 0) {
          throw new Error(`clasificó 0 peticiones — ¿el build apunta a ${emulatorOrigin}? Ajusta --emulator al host:puerto real del emulador.`);
        }
        metrics.push({ name, ms: Date.now() - started, ...requests });
      } catch (error) {
        // A failed phase (bad credentials, selector drift) never discards the
        // metrics already collected — it is recorded and the run continues.
        metrics.push({ name, ms: Date.now() - started, ...requests, error: error.message.slice(0, 120) });
        lines.push(`FASE FALLIDA: ${error.message}`);
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
      page.__measureReset();
      await page.reload({ waitUntil: "networkidle" });
    });

    // Admin — login por UI (como la operadora) y navegación por pantalla.
    if (email && password) {
      const signInIn = async (page) => {
        await page.getByLabel("Correo").fill(email);
        await page.getByLabel("Contraseña").fill(password);
        await page.getByRole("button", { name: "Entrar" }).click();
        await page.waitForTimeout(3500);
        // A rejected login must fail the phase loudly, never report a false
        // zero row (#192 F3): the form still being up means no session was
        // established.
        if (await page.getByLabel("Correo").count()) {
          throw new Error("El login de dev fue rechazado o no completó; revisa --email/--password.");
        }
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

      // #192 fase 2 — the WRITE phase: what saving an order COSTS (the
      // contract tx + the reload the store listener triggers), measured from
      // the guardado click so setup navigation never inflates it.
      await phase("admin · escritura: guardar pedido", `${base}/pedidos/nuevo`, async (page, url) => {
        await page.goto(url, { waitUntil: "networkidle" });
        await signInIn(page);
        await page.waitForTimeout(2500);
        // Cliente y producto del fixture (emulador/dev con datos sintéticos).
        const clientBox = page.getByLabel("Cliente");
        await clientBox.fill(fixtureClient);
        await page.waitForTimeout(800);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(600);
        const productBox = page.getByLabel("Producto", { exact: true });
        await productBox.fill(fixtureProduct);
        await page.waitForTimeout(900);
        // #192 QA (MAYOR): a fixture without this product used to "save" an
        // empty order and report a false zero-cost row — verify the option
        // really exists (and was picked) before clicking Guardar.
        if (!await page.getByRole("option", { name: new RegExp(fixtureProduct, "i") }).count()) {
          throw new Error(`el fixture no tiene el producto "${fixtureProduct}" — pásalo con --product (o siembra el fixture).`);
        }
        await page.keyboard.press("Enter");
        await page.waitForTimeout(800);
        if (!(await productBox.inputValue())) {
          throw new Error(`el producto "${fixtureProduct}" no quedó seleccionado; revisa el fixture.`);
        }
        // Zero the counters right before the money move: this phase reports
        // ONLY the write + its reload.
        page.__measureReset();
        await page.getByRole("button", { name: "Guardar pedido" }).click();
        await page.waitForTimeout(4000);
      });
    }
  } finally {
    await browser.close();
  }

  writeReport(metrics);
  writeFileSync(outPath, reportMarkdown(metrics), "utf8");
  const raw = [...phaseLogs.entries()].map(([name, lines]) => [`── ${name} ──`, ...lines].join("\n")).join("\n\n");
  writeFileSync(`${outPath}.raw-console.log`, raw, "utf8");
  console.log(`✔ Reporte: ${outPath} (+ log crudo por fase en ${outPath}.raw-console.log)`);
}

function writeReport(metrics) {
  console.table(metrics);
}

function reportMarkdown(metrics) {
  const total = (key) => metrics.reduce((sum, row) => sum + row[key], 0);
  const columns = ["Listen", "RunQuery", "BatchGet", "GetDocument", "Write", "Commit", "other"];
  return [
    "# Línea base de consumo — Store OS vs store-os-dev",
    "",
    `Generado: ${new Date().toISOString()} · Emulador clasificador: ${emulatorOrigin} · Fuente: peticiones Firestore por fase + log crudo del SDK.`,
    "Notas de lectura (#192 QA): las cifras son PETICIONES, no lecturas facturables (un batchGet con documentos `missing` cuenta 1); la columna Listen cuenta flushes del canal WebChannel multiplexado (magnitud estable, no aperturas exactas); las conclusiones sobre ausencia de cuellos de botella cubren los flujos medidos y son inferencia direccional hasta medir multilínea, pagos/compras y catálogos grandes.",
    "",
    `| Fase | ${columns.join(" | ")} | ms |`,
    `|---|${columns.map(() => "---").join("|")}|---|`,
    ...metrics.map((row) => `| ${row.name}${row.error ? " ⚠ " + row.error : ""} | ${columns.map((c) => row[c]).join(" | ")} | ${row.ms} |`),
    `| **Total** | ${columns.map((c) => total(c)).join(" | ")} | |`,
    "",
  ].join("\n");
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});
