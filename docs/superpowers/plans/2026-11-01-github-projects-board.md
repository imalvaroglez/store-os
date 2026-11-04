# Migración a GitHub Projects — Plan de implementación

> Plan original de la migración, conservado como antecedente. No reejecutar
> sus pasos sobre el tablero vivo. El cierre y los ajustes de Status nativo,
> verificación y retiro del JSON están documentados en la spec y el script.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar la gestión del trabajo de `docs/backlog.json` (41 entradas, conciliado en main vía PR #116) a un proyecto GitHub Projects V2 "Store OS" (campos Estado/Prioridad/Tipo/Ciclo) y adelgazar la documentación del repo.

**Architecture:** Un script CLI idempotente (`scripts/migrate-backlog-to-projects.cjs`) con lógica pura exportada y testeada desde `src/lib/backlog-migration.test.ts` (patrón `excel-trial`/`backfill` del repo: cargar el CJS con `createRequire`). Tres fases: `--setup` (crea proyecto y campos), `--dry-run` (proyecta sin escribir), `--migrate` (crea issues, agrega items, fija campos, verifica conteos). Las vistas y automatizaciones del tablero se activan en la UI (el CLI de `gh project` no las soporta).

**Tech Stack:** Node ≥18 sin dependencias nuevas, `gh` CLI (scopes `read:project` + `project`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-github-projects-board-design.md` (aprobada por el PO).

**Prerequisito bloqueante (PO, antes de Task 4):** el token de `gh` no tiene scopes de proyecto. Correr y completar el flujo de navegador:

```bash
gh auth refresh -s read:project -s project
```

**Mapa de datos (fuente de verdad para el código):** 41 ítems con estados reales `in-progress: 9, needs-spec: 16, awaiting-approval: 1, done: 14, frozen: 1`. Mapeo de estado → columna: `needs-spec`→Backlog, `awaiting-approval`→Especificado, `in-progress`→`En PR` si su PR sigue abierto, si no `En curso`, `done`→Hecho, `frozen`→Backlog + label `congelado`.

---

### Task 1: Rebase de la rama sobre main post-#116

**Files:** ninguno (solo git).

- [ ] **Step 1.1: Rebasar y empujar**

```bash
git switch codex/projects-board
git rebase origin/main
git push --force-with-lease origin codex/projects-board
```

Expected: rebase limpio (la spec no toca los archivos de #116). Al final `docs/backlog.json` existe localmente con los 41 ítems conciliados.

- [ ] **Step 1.2: Verificar la fuente**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('docs/backlog.json','utf8')).items.length)"
```

Expected: `41`.

### Task 2: Transformaciones puras con TDD

**Files:**
- Create: `scripts/migrate-backlog-to-projects.cjs`
- Test: `src/lib/backlog-migration.test.ts`

- [ ] **Step 2.1: Escribir el test que falla**

Crear `src/lib/backlog-migration.test.ts`:

```typescript
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// Unit tests for the backlog → GitHub Projects migration script
// (scripts/migrate-backlog-to-projects.cjs), following the excel-trial /
// backfill-public-product-store-ids pattern: load the CJS module and declare
// its surface here.

interface BacklogItem {
  id: string;
  title: string;
  status: string;
  priority: number;
  proposedPriority?: string;
  specPath?: string;
  planPath?: string;
  dependsOn?: string[];
  blockedBy?: string[];
  resolvedBlockers?: string[];
  pullRequests?: number[];
  acceptanceCriteria?: string[];
  executionLane?: string;
  discoveryId?: string;
}

const require = createRequire(import.meta.url);
const scriptPath = path.join(__dirname, "../../scripts/migrate-backlog-to-projects.cjs");
const lib = require(scriptPath) as {
  buildIssueTitle: (item: BacklogItem) => string;
  buildIssueBody: (item: BacklogItem, titles: Map<string, string>) => string;
  estadoColumn: (item: BacklogItem, openPrs: Set<number>) => string;
  cicloOf: (id: string) => string;
  tipoOf: (id: string) => string;
  CICLO_OPTIONS: string[];
  ESTADO_OPTIONS: string[];
};

const item = (over: Partial<BacklogItem>): BacklogItem => ({
  id: "fer-order-product-photo",
  title: "Foto del producto en cada línea del pedido",
  status: "needs-spec",
  priority: 10,
  proposedPriority: "P1",
  acceptanceCriteria: ["Seleccionar producto muestra su portada."],
  discoveryId: "FER-18",
  ...over,
});

describe("migrate-backlog-to-projects", () => {
  it("el título lleva el id entre corchetes para trazabilidad e idempotencia", () => {
    expect(lib.buildIssueTitle(item({}))).toBe(
      "[fer-order-product-photo] Foto del producto en cada línea del pedido"
    );
  });

  it("el cuerpo incluye criterios, contexto y pie de migración", () => {
    const body = lib.buildIssueBody(
      item({ specPath: "docs/superpowers/specs/x.md", pullRequests: [112], dependsOn: ["fer-capture-stack"] }),
      new Map([["fer-capture-stack", "Pila de captura"]])
    );
    expect(body).toContain("- Seleccionar producto muestra su portada.");
    expect(body).toContain("docs/superpowers/specs/x.md");
    expect(body).toContain("#112");
    expect(body).toContain("fer-capture-stack"); // dependencia con id legible
    expect(body).toContain("Migrado desde `docs/backlog.json` (PR #116)");
  });

  it("mapea estado JSON a columna del tablero", () => {
    const open = new Set([96]);
    expect(lib.estadoColumn(item({ status: "needs-spec" }), open)).toBe("Backlog");
    expect(lib.estadoColumn(item({ status: "awaiting-approval" }), open)).toBe("Especificado");
    expect(lib.estadoColumn(item({ status: "done" }), open)).toBe("Hecho");
    expect(lib.estadoColumn(item({ status: "frozen" }), open)).toBe("Backlog");
    expect(lib.estadoColumn(item({ status: "in-progress" }), new Set())).toBe("En curso");
    expect(
      lib.estadoColumn(item({ status: "in-progress", pullRequests: [96] }), open)
    ).toBe("En PR");
    // PR cerrado/mergueado ya no cuenta como abierto
    expect(
      lib.estadoColumn(item({ status: "in-progress", pullRequests: [96] }), new Set())
    ).toBe("En curso");
  });

  it("asigna ciclo y tipo desde la tabla del plan de acción", () => {
    expect(lib.cicloOf("persist-entity-error-handling")).toBe("0 · Integridad");
    expect(lib.cicloOf("assisted-october-close")).toBe("Paralelo · Corte octubre");
    expect(lib.cicloOf("fer-order-product-photo")).toBe("1 · Captura");
    expect(lib.cicloOf("fer-monthly-close")).toBe("6 · Cierre mensual");
    expect(lib.cicloOf("id-nuevo-inesperado")).toBe("—");
    expect(lib.tipoOf("refresh-hard-reload")).toBe("deuda");
    expect(lib.tipoOf("fer-order-product-photo")).toBe("feature");
    expect(lib.tipoOf("id-nuevo-inesperado")).toBe("feature");
  });

  it("las opciones de campos son exactas y acotadas", () => {
    expect(lib.ESTADO_OPTIONS).toEqual(["Backlog", "Especificado", "En curso", "En PR", "Hecho"]);
    expect(lib.CICLO_OPTIONS.length).toBeLessThan(20);
    for (const opt of lib.CICLO_OPTIONS.slice(1)) {
      expect(new Set(lib.CICLO_OPTIONS)).toContain(opt);
    }
  });

  // Se salta si backlog.json ya no existe (se elimina en la Task 7).
  const backlogPath = path.join(__dirname, "../../docs/backlog.json");
  describe.skipIf(!fs.existsSync(backlogPath))("cobre del JSON real", () => {
    it("los 41 ítems resuelven ciclo y tipo sin caer en undefined", () => {
      const items: BacklogItem[] = JSON.parse(fs.readFileSync(backlogPath, "utf8")).items;
      for (const it of items) {
        expect(lib.cicloOf(it.id)).toBeTruthy();
        expect(lib.tipoOf(it.id)).toBeTruthy();
      }
    });
  });
});
```

- [ ] **Step 2.2: Verificar que falla**

```bash
npm run test -- src/lib/backlog-migration.test.ts
```

Expected: FAIL — `Cannot find module '.../scripts/migrate-backlog-to-projects.cjs'`.

- [ ] **Step 2.3: Implementar la parte pura del script**

Crear `scripts/migrate-backlog-to-projects.cjs` (solo la sección LIB por ahora; la CLI llega en la Task 3):

```javascript
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
  "receipts": { ciclo: "Evolutivo", tipo: "feature" },
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
  if (item.blockedBy && item.blockedBy.length)
    ctx.push(`- Bloqueado por: ${item.blockedBy.join(", ")}`);
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
```

- [ ] **Step 2.4: Verificar que pasa**

```bash
npm run test -- src/lib/backlog-migration.test.ts
```

Expected: PASS (todas, incluida la de cobre de los 41 ítems del JSON real).

- [ ] **Step 2.5: Commit**

```bash
git add scripts/migrate-backlog-to-projects.cjs src/lib/backlog-migration.test.ts
git commit -m "feat: pure transforms for backlog to Projects migration"
```

### Task 3: CLI del script (dry-run)

**Files:**
- Modify: `scripts/migrate-backlog-to-projects.cjs` (reemplazar el stub del `require.main`)

- [ ] **Step 3.1: Implementar la CLI**

Reemplazar el bloque `if (require.main === module) { ... }` por:

```javascript
// ---------------------------------------------------------------------------
// CLI

function gh(args, opts) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function readBacklog() {
  if (!fs.existsSync(BACKLOG_PATH)) {
    console.error(`No existe ${BACKLOG_PATH}: correr desde un árbol que aún lo incluya (pre-Task 7).`);
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
    return { number: p.number, url: p.url, title: p.title, ciclo: owner ? cicloOf(owner.id) : "Complementario" };
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
      gh(["project", "field-create", String(proj.number), "--owner", OWNER, "--name", field.name,
        "--data-type", "SINGLE_SELECT", "--single-select-options", field.options]);
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
  // Idempotencia: issues existentes se detectan por el prefijo "[<id>]".
  const existing = ghJson(["issue", "list", "--state", "all", "--limit", "300", "--json", "number,title,url"]);
  const existingByTitle = new Map(existing.map((i) => [i.title, i]));

  for (const label of ["congelado"]) {
    try { gh(["label", "create", label, "--color", "bfd4f2", "--description", "Item congelado (decisión PO)"]); }
    catch { /* ya existe */ }
  }

  const created = { issues: 0, skipped: 0 };
  for (const issue of planned.issues) {
    let rec = existingByTitle.get(issue.title);
    if (!rec) {
      const bodyFile = path.join(osTmp(), `backlog-${issue.id}.md`);
      fs.writeFileSync(bodyFile, issue.body);
      const labels = issue.frozen ? ["congelado"] : [];
      const args = ["issue", "create", "--title", issue.title, "--body-file", bodyFile];
      for (const l of labels) args.push("--label", l);
      const url = gh(args, { stdio: ["ignore", "pipe", "inherit"] }).trim();
      fs.unlinkSync(bodyFile);
      rec = { url, number: Number(url.match(/issues\/(\d+)/)[1]) };
      existingByTitle.set(issue.title, rec);
      created.issues++;
    } else {
      created.skipped++;
    }
    const item = ghJson(["project", "item-add", String(project), "--owner", OWNER, "--url", rec.url, "--format", "json"]);
    for (const [field, value] of [["Estado", issue.estado], ["Prioridad", issue.prioridad],
                                   ["Tipo", issue.tipo], ["Ciclo", issue.ciclo]]) {
      if (!value) continue;
      gh(["project", "item-edit", String(project), "--owner", OWNER, "--id", item.id,
        "--field", field, "--value", value]);
    }
    if (issue.done) {
      try { gh(["issue", "close", String(rec.number), "--reason", "completed"]); } catch { /* ya cerrada */ }
    }
    console.log(`issue ${issue.estado.padEnd(13)} ${issue.title}`);
  }

  for (const p of planned.prItems) {
    const item = ghJson(["project", "item-add", String(project), "--owner", OWNER, "--url", p.url, "--format", "json"]);
    for (const [field, value] of [["Estado", "En PR"], ["Ciclo", p.ciclo]]) {
      gh(["project", "item-edit", String(project), "--owner", OWNER, "--id", item.id,
        "--field", field, "--value", value]);
    }
    console.log(`pr    En PR         #${p.number} ${p.title}`);
  }
  console.log(`\nCreadas: ${created.issues}, omitidas (ya existían): ${created.skipped}. Verifica con --verify.`);
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
  const total = issues.length + prs.length;
  if (issues.length < expectedIssues) {
    console.error(`Faltan issues: ${issues.length} de ${expectedIssues}.`);
    process.exit(1);
  }
  console.log(`OK: ${total} items en el tablero.`);
}

function osTmp() {
  return require("node:os").tmpdir();
}

if (require.main === module) main();
```

Nota: mantener el `module.exports` intacto; la CLI se agrega debajo.

- [ ] **Step 3.2: Dry-run local**

```bash
node scripts/migrate-backlog-to-projects.cjs --dry-run
```

Expected (aproximado con los PRs abiertos actuales): `issues: 41`, `prs: 13`, `byEstado ≈ { "En PR": 9, "Backlog": 17, "Especificado": 1, "Hecho": 14 }`, `byCiclo` con las 13 claves de `CICLO_OPTIONS`. Los 5 títulos de muestra legibles y sin `undefined`.

- [ ] **Step 3.3: Commit**

```bash
git add scripts/migrate-backlog-to-projects.cjs
git commit -m "feat: CLI for backlog migration with dry-run, setup and verify"
```

### Task 4: Setup del proyecto (requiere scopes del PO)

**Files:** ninguno (efecto en GitHub). **Prerequisito:** `gh auth refresh -s read:project -s project` completado por el PO.

- [ ] **Step 4.1: Crear proyecto y campos**

```bash
node scripts/migrate-backlog-to-projects.cjs --setup
```

Expected: `Proyecto creado: número <N> — https://github.com/users/imalvaroglez/projects/<N>` más 4 líneas `Campo creado: ...`.

- [ ] **Step 4.2: Verificar campos**

```bash
gh project view <N> --owner imalvaroglez --format json | head -5
```

Expected: JSON del proyecto con título "Store OS".

### Task 5: Migración real

**Files:** ninguno (efecto en GitHub).

- [ ] **Step 5.1: Ejecutar**

```bash
node scripts/migrate-backlog-to-projects.cjs --project <N> --migrate
```

Expected: 41 líneas `issue <estado> <título>` (14 cierres de issues done incluidos) + 13 líneas `pr En PR #<n> ...`. Duración ~2–4 min.

- [ ] **Step 5.2: Verificar**

```bash
node scripts/migrate-backlog-to-projects.cjs --project <N> --verify
```

Expected: `issues: 41`, `prs: 13`, `estados` con `Hecho: 14`, `En PR: 9+13` items en columna... (los PR también fijan Estado `En PR`), `OK: 54 items en el tablero.`

- [ ] **Step 5.3: Idempotencia (re-ejecución no duplica)**

```bash
node scripts/migrate-backlog-to-projects.cjs --project <N> --migrate
```

Expected: `Creadas: 0, omitidas (ya existían): 41`.

### Task 6: Vistas y automatización (PO, UI, ~2 min)

El CLI de `gh project` no crea vistas ni workflows; el PO los agrega en `https://github.com/users/imalvaroglez/projects/<N>`:

- [ ] **Vista "Tablero"**: + Nueva vista → Tablero → agrupar por `Estado`; filtro `Tipo de item = Issue`.
- [ ] **Vista "Cola"**: + Nueva vista → Tabla → ordenar por `Ciclo` y luego `Prioridad`; ocultar columnas sobrantes.
- [ ] **Vista "PRs abiertos"**: + Nueva vista → Tabla → filtro `Tipo de item = Pull request`.
- [ ] **Automatización** (configuración del proyecto → Workflows): activar "Cuando un pull request se fusiona → Estado = Hecho" (y "PR abierto → En PR" si el workflow lo ofrece).

### Task 7: Documentación del repo

**Files:**
- Delete: `docs/backlog.json`
- Modify: `docs/BACKLOG.md` (reescritura completa)
- Modify: `LOOPS.md` (raíz, sección `## Backlog`)
- Modify: `CLAUDE.md` y `AGENTS.md` (paridad idéntica)

- [ ] **Step 7.1: Borrar el JSON**

```bash
git rm docs/backlog.json
```

- [ ] **Step 7.2: Reescribir `docs/BACKLOG.md`** con este contenido completo:

```markdown
# Backlog

El estado vivo del trabajo vive en el [tablero "Store OS"](https://github.com/users/imalvaroglez/projects)
(GitHub Projects): una issue por capacidad, con criterios de aceptación, prioridad
(P0–P3), tipo y ciclo. La issue es la unidad de trabajo; la spec de archivo es
excepcional y viaja dentro del PR del código cuando hay decisiones de arquitectura
o reglas de negocio.

Este archivo ya no registra estados. Conserva solo el contexto de descubrimiento
que respalda al tablero:

- [Plan de acción de Fer](fer-action-plan-2026-11-01.md) — backlog vigente conciliado
  con los PR y la liberación del 1 de noviembre; secuencia de ciclos y decisiones
  confirmadas/pendientes por capability.
- [Backlog de Olivia (entrevista Fer)](fer-backlog-2026-10-28.md) — 17 candidatos con
  criterios de resultado; antecedente de descubrimiento.
- [Diagnóstico técnico y plan incremental](olivia-technical-diagnostic-2026-10-28.md) —
  contraste de las 39 historias OLI contra el código; antecedente.

Regla anti doble-fuente: si este documento y el tablero discrepan, gana el tablero
y este archivo se corrige. Nada vuelve a entrar aquí "para que quede escrito".
```

(El enlace del tablero usa la URL completa `https://github.com/users/imalvaroglez/projects/<N>/views/1` una vez conocida la N del Step 4.1.)

- [ ] **Step 7.3: Actualizar `LOOPS.md`** — reemplazar la sección actual:

```markdown
## Backlog

`docs/backlog.json` es la lista viva de items (dato, sin gating). El flujo de ideas sigue en [`docs/BACKLOG.md`](docs/BACKLOG.md).
```

por:

```markdown
## Backlog

La lista viva es el tablero "Store OS" de GitHub Projects: una issue por capacidad
con criterios de aceptación, y campos Estado / Prioridad / Tipo / Ciclo. Los
agentes lo consultan y actualizan con `gh project` / `gh issue`. El contexto de
descubrimiento (entrevistas, diagnóstico, plan de acción) sigue en
[`docs/BACKLOG.md`](docs/BACKLOG.md); ningún documento del repo registra estados.
```

- [ ] **Step 7.4: Actualizar `CLAUDE.md` y `AGENTS.md` en paridad** — en ambos:
  1. `grep -n "backlog.json\|BACKLOG" <archivo>` y reemplazar cada mención de `docs/backlog.json` como "lista viva" por el tablero.
  2. Agregar la misma sección corta (después de "Flujo de entrega" en ambos):

```markdown
## Gestión del trabajo

La cola vive en el tablero "Store OS" de GitHub Projects (issues + PRs; campos
Estado / Prioridad / Tipo / Ciclo). La issue es la unidad de trabajo: criterios de
aceptación en su cuerpo. La spec de archivo es excepcional (decisiones de
arquitectura o reglas de negocio) y viaja dentro del PR. Los agentes consultan y
actualizan el tablero con `gh project` / `gh issue`; si `gh` falla, preguntan.
Ver `docs/superpowers/specs/2026-11-01-github-projects-board-design.md`.
```

  3. Verificar paridad: `diff <(sed -n '/## Gestión del trabajo/,/^## /p' CLAUDE.md) <(sed -n '/## Gestión del trabajo/,/^## /p' AGENTS.md)` (expected: idénticos).

- [ ] **Step 7.5: Commit**

```bash
git add -A
git commit -m "docs: move live backlog state to GitHub Projects board"
```

### Task 8: Validación y PR

- [ ] **Step 8.1: Suite completa**

```bash
npm run typecheck && npm run test && npm run build
```

Expected: todo verde (419 pruebas + las nuevas de `backlog-migration`; el test de cobre se autodestruye sin error porque `backlog.json` ya no existe).

- [ ] **Step 8.2: Push y PR draft**

```bash
git push origin codex/projects-board
gh pr create --draft --base main --head codex/projects-board \
  --title "chore: migrate backlog management to GitHub Projects" \
  --body "Migra el estado vivo de docs/backlog.json (41 items, PR #116) al tablero GitHub Projects 'Store OS': script idempotente + dry-run, issues con criterios, PRs abiertos como items, docs adelgazados (backlog.json fuera, LOOPS/CLAUDE/AGENTS en paridad). Spec: docs/superpowers/specs/2026-11-01-github-projects-board-design.md"
```

- [ ] **Step 8.3: Esperar CI y confirmar checks**

```bash
gh pr checks
```

Expected: todos en pass o skipping (regla PO: ningún PR "listo" sin CI completo). Al tocar `src/` se espera que corra la suite completa en CI.

---

## Self-review del plan (ya ejecutado)

- **Cobertura de spec**: Decisión 1 (campos/vistas) → Tasks 3–6; Decisión 2 (issue unidad, specs excepcionales) → Task 7 (LOOPS/CLAUDE/AGENTS); Decisión 3 (repo = decisiones duraderas) → Task 7.2; Decisión 4 (agentes via gh) → Task 7.3/7.4; Decisión 5 (no cambia gates) → Task 8. Migración completa → Tasks 3–5. Secuencia → Tasks 1–8.
- **Placeholders**: ninguno; todo el código y textos están completos.
- **Consistencia**: `ESTADO_OPTIONS`/`CICLO_OPTIONS`/`ITEM_META` y las firmas `buildIssueTitle/buildIssueBody/estadoColumn/cicloOf/tipoOf` coinciden entre test y script; el pie `Migrado desde… (PR #116)` coincide con la aserción del test.
