import { createRequire } from "node:module";
import fs from "node:fs";

// Unit tests for the backlog → GitHub Projects migration script
// (scripts/migrate-backlog-to-projects.cjs), following the excel-trial /
// backfill-public-product-store-ids pattern: load the CJS module via
// createRequire and declare its surface here.

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
const lib = require("../../scripts/migrate-backlog-to-projects.cjs") as {
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
      item({
        specPath: "docs/superpowers/specs/x.md",
        pullRequests: [112],
        dependsOn: ["fer-capture-stack"],
      }),
      new Map([["fer-capture-stack", "Pila de captura"]])
    );
    expect(body).toContain("- Seleccionar producto muestra su portada.");
    expect(body).toContain("docs/superpowers/specs/x.md");
    expect(body).toContain("#112");
    expect(body).toContain("fer-capture-stack");
    expect(body).toContain("Migrado desde `docs/backlog.json` (PR #116)");
  });

  it("mapea estado JSON a columna del tablero", () => {
    const open = new Set([96]);
    expect(lib.estadoColumn(item({ status: "needs-spec" }), open)).toBe("Backlog");
    expect(lib.estadoColumn(item({ status: "awaiting-approval" }), open)).toBe("Especificado");
    expect(lib.estadoColumn(item({ status: "done" }), open)).toBe("Hecho");
    expect(lib.estadoColumn(item({ status: "frozen" }), open)).toBe("Backlog");
    expect(lib.estadoColumn(item({ status: "in-progress" }), open)).toBe("En curso");
    expect(lib.estadoColumn(item({ status: "in-progress", pullRequests: [96] }), open)).toBe("En PR");
    // PR cerrado/mergueado ya no cuenta como abierto
    expect(lib.estadoColumn(item({ status: "in-progress", pullRequests: [96] }), new Set())).toBe(
      "En curso"
    );
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
    expect(new Set(lib.CICLO_OPTIONS).size).toBe(lib.CICLO_OPTIONS.length);
  });

  // Se salta si backlog.json ya no existe (se elimina en la Task 7).
  let backlogPath: string | null = null;
  try {
    backlogPath = require.resolve("../../docs/backlog.json");
  } catch {
    backlogPath = null;
  }
  describe.skipIf(!backlogPath)("cobertura del JSON real", () => {
    it("los 41 ítems resuelven ciclo y tipo sin caer en vacío", () => {
      const items: BacklogItem[] = JSON.parse(fs.readFileSync(backlogPath!, "utf8")).items;
      expect(items.length).toBe(41);
      for (const it of items) {
        expect(lib.cicloOf(it.id)).toBeTruthy();
        expect(lib.tipoOf(it.id)).toBeTruthy();
      }
    });
  });
});
