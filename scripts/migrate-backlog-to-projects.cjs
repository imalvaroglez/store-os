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

// CLI lives below this guard (added in Task 3).
if (require.main === module) {
  console.error("CLI no implementado todavía (Task 3).");
  process.exit(1);
}
