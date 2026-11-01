#!/usr/bin/env node
// Migrate docs/backlog.json (reconciled by PR #116) to a GitHub Projects V2
// board ("Store OS"). Idempotent: existing issues are detected by their
// "[<id>] <title>" prefix and skipped. Pure transforms are unit-tested from
// src/lib/backlog-migration.test.ts (createRequire pattern).
//
// Usage:
//   node scripts/migrate-backlog-to-projects.cjs --dry-run
//   node scripts/migrate-backlog-to-projects.cjs --setup
//   node scripts/migrate-backlog-to-projects.cjs --project <number> --migrate
//   node scripts/migrate-backlog-to-projects.cjs --project <number> --verify

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const OWNER = "imalvaroglez";
const PROJECT_TITLE = "Store OS";
const BACKLOG_PATH = path.join(__dirname, "..", "docs", "backlog.json");

// ---------------------------------------------------------------------------
// LIB — pure transforms (exported for tests)

const ESTADO_OPTIONS = ["Backlog", "Especificado", "En curso", "En PR", "Hecho"];

// Ciclo values mirror the action plan ordering (docs/fer-action-plan-2026-11-01.md).
const CICLO_OPTIONS = [
  "—",
  "0 · Integridad",
  "Paralelo · Corte octubre",
  "1 · Captura",
  "2 · Cobros",
  "3 · Variantes",
  "4 · Compras",
  "5 · Costo y ganancia",
  "6 · Cierre mensual",
  "7 · Iconic y reposición",
  "8 · Catálogo y solicitudes",
  "Complementario",
  "Evolutivo",
];

// id → { ciclo, tipo }. Derived from the action plan's order table; "—" marks
// delivered/historical entries with no forward-looking cycle.
const ITEM_META = {
  "persist-entity-error-handling": { ciclo: "0 · Integridad", tipo: "deuda" },
  "eradicate-local-admin-mode": { ciclo: "0 · Integridad", tipo: "deuda" },
  "assisted-october-close": { ciclo: "Paralelo · Corte octubre", tipo: "ops" },
  "fer-order-product-photo": { ciclo: "1 · Captura", tipo: "feature" },
  "fer-product-entry-defaults": { ciclo: "1 · Captura", tipo: "feature" },
  "fer-capture-stack": { ciclo: "1 · Captura", tipo: "feature" },
  "fer-order-payments": { ciclo: "2 · Cobros", tipo: "feature" },
  "fer-product-variants": { ciclo: "3 · Variantes", tipo: "feature" },
  "fer-purchase-trip-cost": { ciclo: "4 · Compras", tipo: "feature" },
  "fer-cost-allocation": { ciclo: "4 · Compras", tipo: "feature" },
  "fer-sale-profit": { ciclo: "5 · Costo y ganancia", tipo: "feature" },
  "fer-profit-distribution": { ciclo: "6 · Cierre mensual", tipo: "feature" },
  "fer-monthly-close": { ciclo: "6 · Cierre mensual", tipo: "feature" },
  "fer-iconic-renewal": { ciclo: "7 · Iconic y reposición", tipo: "feature" },
  "fer-low-stock-alerts": { ciclo: "7 · Iconic y reposición", tipo: "feature" },
  "fer-monthly-reseller-ranking": { ciclo: "7 · Iconic y reposición", tipo: "feature" },
  "wysiwyg-catalog": { ciclo: "8 · Catálogo y solicitudes", tipo: "feature" },
  "fer-catalog-visual-home": { ciclo: "8 · Catálogo y solicitudes", tipo: "feature" },
  "fer-catalog-subcategories": { ciclo: "8 · Catálogo y solicitudes", tipo: "feature" },
  "fer-catalog-cohesion": { ciclo: "8 · Catálogo y solicitudes", tipo: "feature" },
  "fer-public-product-variants": { ciclo: "8 · Catálogo y solicitudes", tipo: "feature" },
  "fer-catalog-order-request": { ciclo: "8 · Catálogo y solicitudes", tipo: "feature" },
  "migrate-adminstores": { ciclo: "Complementario", tipo: "deuda" },
  "platform-users-view": { ciclo: "Complementario", tipo: "feature" },
  "privacy-arco-v1": { ciclo: "Complementario", tipo: "feature" },
  receipts: { ciclo: "Evolutivo", tipo: "feature" },
  "member-roles": { ciclo: "Evolutivo", tipo: "feature" },
  "productos-sort-filter": { ciclo: "—", tipo: "feature" },
  "purchase-ux2-fast-receive": { ciclo: "—", tipo: "feature" },
  "refresh-hard-reload": { ciclo: "—", tipo: "deuda" },
  "pnpm-lockfile": { ciclo: "—", tipo: "deuda" },
  "unified-products": { ciclo: "—", tipo: "feature" },
  "reliable-member-invitations": { ciclo: "—", tipo: "feature" },
  "scalable-pricing": { ciclo: "—", tipo: "feature" },
  "fer-purchase-expenses": { ciclo: "—", tipo: "feature" },
  "fer-customer-price-tier": { ciclo: "—", tipo: "feature" },
  "fer-order-prepend": { ciclo: "—", tipo: "feature" },
  "fer-order-category-groups": { ciclo: "—", tipo: "feature" },
  "public-product-detail": { ciclo: "—", tipo: "deuda" },
  "carrito-publico": { ciclo: "—", tipo: "feature" },
  "store-settings-owner-entry": { ciclo: "—", tipo: "feature" },
};

function cicloOf(id) {
  return (ITEM_META[id] || {}).ciclo || "—";
}

function tipoOf(id) {
  return (ITEM_META[id] || {}).tipo || "feature";
}

function buildIssueTitle(item) {
  return `[${item.id}] ${item.title}`;
}

function buildIssueBody(item, titles) {
  const lines = [];
  if (item.discoveryId) lines.push(`**${item.discoveryId}**`, "");
  if (item.acceptanceCriteria && item.acceptanceCriteria.length) {
    lines.push("### Criterios de aceptación", "");
    for (const c of item.acceptanceCriteria) lines.push(`- ${c}`);
    lines.push("");
  }
  const ctx = [];
  if (item.specPath) ctx.push(`- Spec: ${item.specPath}`);
  if (item.planPath) ctx.push(`- Plan: ${item.planPath}`);
  if (item.pullRequests && item.pullRequests.length)
    ctx.push(`- PRs: ${item.pullRequests.map((n) => `#${n}`).join(", ")}`);
  if (item.dependsOn && item.dependsOn.length)
    ctx.push(
      `- Depende de: ${item.dependsOn.map((d) => `${d} (${(titles && titles.get(d)) || "?"})`).join(", ")}`
    );
  if (item.resolvedBlockers && item.resolvedBlockers.length)
    ctx.push(`- Bloqueos resueltos: ${item.resolvedBlockers.join("; ")}`);
  if (item.blockedBy && item.blockedBy.length) ctx.push(`- Bloqueado por: ${item.blockedBy.join(", ")}`);
  if (ctx.length) lines.push("### Contexto", "", ...ctx, "");
  const meta = [`prioridad original: ${item.priority}`];
  if (item.proposedPriority) meta.push(`propuesta: ${item.proposedPriority}`);
  if (item.executionLane) meta.push(`lane: ${item.executionLane}`);
  lines.push("---", "", `Migrado desde \`docs/backlog.json\` (PR #116) · ${meta.join(" · ")}`);
  return lines.join("\n");
}

function estadoColumn(item, openPrs) {
  if (item.status === "done") return "Hecho";
  if (item.status === "awaiting-approval") return "Especificado";
  if (item.status === "in-progress") {
    const hasOpenPr = (item.pullRequests || []).some((n) => openPrs.has(n));
    return hasOpenPr ? "En PR" : "En curso";
  }
  return "Backlog"; // needs-spec, frozen y cualquier otro estado futuro
}

module.exports = { ESTADO_OPTIONS, CICLO_OPTIONS, buildIssueTitle, buildIssueBody, estadoColumn, cicloOf, tipoOf };

// ---------------------------------------------------------------------------
// CLI

function gh(args, opts) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// gh's project mutations fail under GitHub's secondary rate limit when fired
// in bursts ("Something went wrong…" / "API rate limit exceeded"), even with
// primary quota left. Pace every mutation and back off exponentially.
// Retries are safe: item-add is idempotent (adding an existing item returns
// it) and item-edit sets absolute values.
function ghRetry(args, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return gh(args);
    } catch (err) {
      lastErr = err;
      const waitMs = 2000 * 2 ** i;
      console.error(`  (reintento ${i + 1}/${tries} en ${waitMs / 1000}s: ${args.slice(0, 3).join(" ")})`);
      sleep(waitMs);
    }
  }
  throw lastErr;
}

function ghJsonRetry(args) {
  return JSON.parse(ghRetry(args));
}

function readBacklog() {
  if (!fs.existsSync(BACKLOG_PATH)) {
    console.error(`No existe ${BACKLOG_PATH}: correr desde un árbol que aún lo incluya (pre Task 7 del plan).`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(BACKLOG_PATH, "utf8")).items;
}

function openPrs() {
  const prs = ghJson(["pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,url"]);
  return { numbers: new Set(prs.map((p) => p.number)), list: prs };
}

function planIssues(items, prs) {
  const titles = new Map(items.map((i) => [i.id, i.title]));
  const issues = items.map((item) => ({
    id: item.id,
    title: buildIssueTitle(item),
    body: buildIssueBody(item, titles),
    estado: estadoColumn(item, prs.numbers),
    prioridad: item.proposedPriority || null,
    tipo: tipoOf(item.id),
    ciclo: cicloOf(item.id),
    done: item.status === "done",
    frozen: item.status === "frozen",
  }));
  // Open PRs enter as items too; cycle resolved from the entry that tracks them.
  const prItems = prs.list.map((p) => {
    const owner = items.find((i) => (i.pullRequests || []).includes(p.number));
    return {
      number: p.number,
      url: p.url,
      title: p.title,
      ciclo: owner ? cicloOf(owner.id) : "Complementario",
    };
  });
  return { issues, prItems };
}

function summary(planned) {
  const byEstado = {};
  for (const i of planned.issues) byEstado[i.estado] = (byEstado[i.estado] || 0) + 1;
  const byCiclo = {};
  for (const i of planned.issues) byCiclo[i.ciclo] = (byCiclo[i.ciclo] || 0) + 1;
  return { issues: planned.issues.length, byEstado, byCiclo, prs: planned.prItems.length };
}

// item-edit by name: --url points at the issue/PR, --field names the field,
// --value is the single-select option name (per `gh project item-edit --help`).
// Each gh project mutation costs 2-3 internal requests; GitHub's secondary
// limit trips around ~100 req/min, so pace one mutation every ~2.5s.
const MUTATION_PACE_MS = 2500;

function setField(project, url, field, value) {
  sleep(MUTATION_PACE_MS);
  ghRetry([
    "project", "item-edit", String(project), "--owner", OWNER, "--url", url,
    "--field", field, "--value", value,
  ]);
}

function addItem(project, url) {
  sleep(MUTATION_PACE_MS);
  ghJsonRetry(["project", "item-add", String(project), "--owner", OWNER, "--url", url, "--format", "json"]);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--dry-run")) {
    const planned = planIssues(readBacklog(), openPrs());
    console.log(JSON.stringify(summary(planned), null, 2));
    console.log("\nMuestra de issues proyectadas:");
    for (const i of planned.issues.slice(0, 5)) console.log(`  [${i.estado}] ${i.title}`);
    console.log("PRs como items:", planned.prItems.map((p) => `#${p.number}`).join(", "));
    return;
  }
  if (argv.includes("--setup")) {
    const proj = ghJson(["project", "create", "--owner", OWNER, "--title", PROJECT_TITLE, "--format", "json"]);
    console.log(`Proyecto creado: número ${proj.number} — ${proj.url}`);
    for (const field of [
      { name: "Estado", options: ESTADO_OPTIONS.join(",") },
      { name: "Prioridad", options: "P0,P1,P2,P3" },
      { name: "Tipo", options: "feature,deuda,ops" },
      { name: "Ciclo", options: CICLO_OPTIONS.join(",") },
    ]) {
      gh([
        "project", "field-create", String(proj.number), "--owner", OWNER, "--name", field.name,
        "--data-type", "SINGLE_SELECT", "--single-select-options", field.options,
      ]);
      console.log(`Campo creado: ${field.name}`);
    }
    console.log(`\nSiguiente: node scripts/migrate-backlog-to-projects.cjs --project ${proj.number} --migrate`);
    return;
  }
  const projectFlag = argv.indexOf("--project");
  const project = projectFlag >= 0 ? argv[projectFlag + 1] : null;
  if (!project) {
    console.error("Falta --project <number> (o usa --setup / --dry-run).");
    process.exit(1);
  }
  if (argv.includes("--migrate")) {
    runMigrate(project);
  } else if (argv.includes("--verify")) {
    runVerify(project);
  } else {
    console.error("Nada que hacer: usa --dry-run, --setup, --project N --migrate o --project N --verify.");
    process.exit(1);
  }
}

function runMigrate(project) {
  const items = readBacklog();
  const prs = openPrs();
  const planned = planIssues(items, prs);
  // Idempotencia: issues existentes se detectan por su título exacto "[<id>] <título>".
  const existing = ghJson(["issue", "list", "--state", "all", "--limit", "300", "--json", "number,title,url"]);
  const existingByTitle = new Map(existing.map((i) => [i.title, i]));

  for (const label of ["congelado"]) {
    try {
      gh(["label", "create", label, "--color", "bfd4f2", "--description", "Item congelado (decisión PO)"]);
    } catch {
      /* ya existe */
    }
  }

  const created = { issues: 0, skipped: 0 };
  const failures = [];
  // Items already on the board skip item-add (saves mutations and burst noise).
  const inProject = new Set(
    ghJsonRetry(["project", "item-list", String(project), "--owner", OWNER, "--format", "json", "--limit", "200"])
      .items.map((i) => i.url)
  );
  for (const issue of planned.issues) {
    let rec = existingByTitle.get(issue.title);
    if (!rec) {
      const bodyFile = path.join(require("node:os").tmpdir(), `backlog-${issue.id}.md`);
      fs.writeFileSync(bodyFile, issue.body);
      const args = ["issue", "create", "--title", issue.title, "--body-file", bodyFile];
      if (issue.frozen) args.push("--label", "congelado");
      const url = gh(args).trim();
      fs.unlinkSync(bodyFile);
      rec = { url, number: Number(url.match(/issues\/(\d+)/)[1]) };
      existingByTitle.set(issue.title, rec);
      created.issues++;
    } else {
      created.skipped++;
    }
    try {
      if (!inProject.has(rec.url)) addItem(project, rec.url);
      for (const [field, value] of [
        ["Estado", issue.estado],
        ["Prioridad", issue.prioridad],
        ["Tipo", issue.tipo],
        ["Ciclo", issue.ciclo],
      ]) {
        if (!value) continue;
        setField(project, rec.url, field, value);
      }
      if (issue.done) {
        try {
          gh(["issue", "close", String(rec.number), "--reason", "completed"]);
        } catch {
          /* ya cerrada */
        }
      }
      console.log(`issue ${issue.estado.padEnd(13)} ${issue.title}`);
    } catch (err) {
      failures.push(`${issue.title}: ${String(err).split("\n")[0]}`);
      console.error(`FALLO ${issue.title}`);
    }
  }

  for (const p of planned.prItems) {
    try {
      if (!inProject.has(p.url)) addItem(project, p.url);
      for (const [field, value] of [
        ["Estado", "En PR"],
        ["Ciclo", p.ciclo],
      ]) {
        setField(project, p.url, field, value);
      }
      console.log(`pr    En PR         #${p.number} ${p.title}`);
    } catch (err) {
      failures.push(`PR #${p.number}: ${String(err).split("\n")[0]}`);
      console.error(`FALLO PR #${p.number}`);
    }
  }
  console.log(`\nCreadas: ${created.issues}, omitidas (ya existían): ${created.skipped}. Verifica con --verify.`);
  if (failures.length) {
    console.error(`\n${failures.length} fallos (re-ejecuta --migrate; es idempotente):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

function runVerify(project) {
  const items = ghJson(["project", "item-list", String(project), "--owner", OWNER, "--format", "json", "--limit", "200"]);
  const issues = items.filter((i) => i.type === "ISSUE");
  const prs = items.filter((i) => i.type === "PULL_REQUEST");
  const estados = {};
  for (const i of issues) {
    const est = (i.fieldValues || []).find((f) => f.field === "Estado");
    const name = est ? est.value : "(sin estado)";
    estados[name] = (estados[name] || 0) + 1;
  }
  console.log(JSON.stringify({ issues: issues.length, prs: prs.length, estados }, null, 2));
  const expectedIssues = readBacklog().length;
  if (issues.length < expectedIssues) {
    console.error(`Faltan issues: ${issues.length} de ${expectedIssues}.`);
    process.exit(1);
  }
  console.log(`OK: ${issues.length + prs.length} items en el tablero.`);
}

if (require.main === module) main();
