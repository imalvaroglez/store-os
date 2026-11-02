import { createRequire } from "node:module";

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
  planIssues: (items: BacklogItem[], prs: { numbers: Set<number>; list: { number: number; url: string; title: string }[] }) => { issues: { estado: string }[]; prItems: { tipo: string; ciclo: string }[] };
  normalizeBoardItem: (item: Record<string, unknown>) => Record<string, unknown>;
  validateBoard: (planned: { issues: Record<string, unknown>[]; prItems: Record<string, unknown>[] }, items: Record<string, unknown>[], records: { number: number; state: string }[]) => string[];
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

  it("resuelve ciclo y estado del PR a partir de la capacidad correspondiente", () => {
    const planned = lib.planIssues([item({ status: "in-progress", pullRequests: [9] })], {
      numbers: new Set([9]), list: [{ number: 9, url: "pr", title: "Capture" }],
    });
    expect(planned.issues[0].estado).toBe("En PR");
    expect(planned.prItems[0]).toMatchObject({ tipo: "feature", ciclo: "1 · Captura" });
  });

  it("usa Status nativo como estado y evita leer una copia importada desactualizada", () => {
    expect(lib.normalizeBoardItem({ status: "Hecho", estado: "Backlog" }).estado).toBe("Hecho");
  });

  const planned = {
    issues: [{ id: "known", body: "- Criterion", estado: "Hecho", prioridad: "P1", tipo: "feature", ciclo: "1 · Captura", done: true }],
    prItems: [{ url: "https://github.com/owner/repo/pull/3", tipo: "feature", ciclo: "1 · Captura" }],
  };
  const boardIssue = { content: { type: "Issue", title: "[known] Title", number: 2, url: "issue", body: "- Criterion" }, estado: "Hecho", prioridad: "P1", tipo: "feature", ciclo: "1 · Captura" };
  const boardPr = { content: { type: "PullRequest", url: planned.prItems[0].url }, estado: "En PR", tipo: "feature", ciclo: "1 · Captura" };
  const records = [{ number: 2, state: "CLOSED" }];

  it("valida identidad, criterios, campos, cierre histórico y PRs", () => {
    expect(lib.validateBoard(planned, [boardIssue, boardPr], records)).toEqual([]);
  });

  it("rechaza un tablero con suficientes filas pero sin el PR esperado", () => {
    expect(lib.validateBoard(planned, [boardIssue, { content: { type: "PullRequest", url: "other" } }], records)).toContainEqual(expect.stringContaining("found 0"));
  });

  it("rechaza duplicados, campos incompletos y cierres que fallaron", () => {
    expect(lib.validateBoard(planned, [boardIssue, boardIssue, boardPr], records)).toContainEqual(expect.stringContaining("found 2"));
    const incomplete = { ...boardIssue, tipo: undefined, content: { ...boardIssue.content, body: "" } };
    const errors = lib.validateBoard(planned, [incomplete, boardPr], [{ number: 2, state: "OPEN" }]);
    expect(errors).toContainEqual(expect.stringContaining("tipo should"));
    expect(errors).toContainEqual(expect.stringContaining("criteria/context missing"));
    expect(errors).toContainEqual(expect.stringContaining("not closed"));
  });
});
