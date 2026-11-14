// Vitest can import plain .mjs — the report formatter's contract lives here.
import { describe, expect, it } from "vitest";
import { buildUsageReport } from "./usage-report-lib.mjs";

// #191 fase 1: reporte MANUAL, local y privado. Ejemplos sintéticos: matemática
// de cuotas, marcado explícito de ausente/estimado/sin acceso, zona de
// reinicio y periodos incompatibles nunca comparados.

const base = (overrides) => ({
  id: "x",
  label: "Métrica",
  status: "measured",
  unit: "lecturas",
  period: "últimas 24 h",
  value: undefined,
  quota: undefined,
  quotaPeriod: "diaria",
  resetNote: undefined,
  source: "Monitoring API",
  ...overrides,
});

describe("buildUsageReport (#191 fase 1)", () => {
  it("calcula porcentaje y margen restante contra la cuota aplicable", () => {
    const report = buildUsageReport([
      base({ id: "dev.reads", label: "Firestore dev · lecturas", value: 12500, quota: 50000, resetNote: "reinicia en horario del Pacífico (PT)" }),
    ]);
    expect(report).toContain("Firestore dev · lecturas");
    expect(report).toMatch(/12,500 lecturas \/ 50,000 \(25\.0%\)/);
    expect(report).toMatch(/margen 37,500/);
    expect(report).toContain("reinicia en horario del Pacífico (PT)");
  });

  it("marca AUSENTE con motivo — jamás lo presenta como cero", () => {
    const report = buildUsageReport([
      base({ id: "vercel", label: "Vercel · uso", status: "absent", absentReason: "sin VERCEL_TOKEN local (no se guardan credenciales)", source: "—" }),
    ]);
    expect(report).toContain("AUS");
    expect(report).toContain("sin VERCEL_TOKEN");
    expect(report).not.toMatch(/Vercel · uso.*\b0\b/);
  });

  it("marca ESTIMADO cuando la métrica no es la unidad exacta de la cuota", () => {
    const report = buildUsageReport([
      base({ id: "egress", label: "Firestore dev · salida", status: "estimated", value: 0.4, unit: "GiB (aprox)", quota: 10, period: "mes en curso", source: "sin exportación de facturación" }),
    ]);
    expect(report).toContain("EST");
    expect(report).toContain("aprox");
  });

  it("marca SIN ACCESO cuando falta permiso, con el permiso exacto documentado", () => {
    const report = buildUsageReport([
      base({ id: "auth.users", label: "Auth · cuentas", status: "denied", deniedPermission: "roles/monitoring.viewer (o habilitar monitoring.googleapis.com)", source: "—" }),
    ]);
    expect(report).toContain("SIN ACCESO");
    expect(report).toContain("roles/monitoring.viewer");
  });

  it("separa periodos incompatibles: diario y mensual jamás en la misma línea de cuota", () => {
    const report = buildUsageReport([
      base({ id: "dev.reads.d", label: "Lecturas (24 h)", value: 9000, quota: 50000, quotaPeriod: "diaria", period: "últimas 24 h" }),
      base({ id: "dev.reads.m", label: "Lecturas (30 días)", value: 92000, quota: undefined, quotaPeriod: "sin cuota mensual (la cuota es diaria)", period: "últimos 30 días" }),
    ]);
    expect(report).toContain("Lecturas (24 h)");
    expect(report).toContain("Lecturas (30 días)");
    expect(report).toContain("sin cuota mensual");
  });

  it("avisa que no es factura y que lo privado no sale de la máquina", () => {
    const report = buildUsageReport([]);
    expect(report).toContain("Reporte local y privado");
    expect(report).toContain("no es una factura");
  });

  it("incluye fecha de generación y fuente por métrica", () => {
    const report = buildUsageReport(
      [base({ id: "x", label: "Métrica", value: 1, quota: 10, source: "Cloud Monitoring API", sourceUpdatedAt: "2026-11-14T07:00:00Z" })],
      { generatedAt: "2026-11-14T07:05:00Z" }
    );
    expect(report).toContain("2026-11-14T07:05:00Z");
    expect(report).toContain("Cloud Monitoring API");
    expect(report).toContain("2026-11-14T07:00:00Z");
  });

  it("#191 r2: MED/EST sin valor NO imprime cero falso ni porcentaje basura", () => {
    const report = buildUsageReport([
      base({ id: "writes.day", label: "Firestore dev · escrituras", status: "estimated", value: undefined, quota: 20000 }),
    ]);
    expect(report).toContain("valor no disponible");
    expect(report).not.toMatch(/escrituras: 0\b/); // cero falso en el PUESTO del valor
    expect(report).not.toMatch(/NaN|undefined/);
  });

  it("#191 r2: incluye leyenda de marcadores en el propio output", () => {
    const report = buildUsageReport([]);
    expect(report).toMatch(/Leyenda:.*MED.*EST.*AUS.*SIN ACCESO/s);
  });

  it("cuota superada se muestra en negativo explícito, no oculta el exceso", () => {
    const report = buildUsageReport([
      base({ id: "over", label: "Escrituras", value: 22000, quota: 20000, unit: "escrituras" }),
    ]);
    expect(report).toMatch(/-2,000/);
    expect(report).toContain("110.0%");
  });
});
