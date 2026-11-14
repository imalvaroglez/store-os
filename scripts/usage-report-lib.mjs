// #191 — fase 1: formateador PURO del reporte manual de consumo (JS plano,
// compartido por scripts/usage-report.mjs y su prueba). Nada se persiste.
// La falta de datos JAMÁS se presenta como cero; periodos diarios/mensuales
// no se mezclan.

export function buildUsageReport(metrics, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lines = [
    "Store OS — reporte manual de consumo (fase 1, #191)",
    `Generado: ${generatedAt} · Reporte local y privado: no se publica ni se adjunta a issues/PRs.`,
    "Esto no es una factura ni una garantía de costo cero: cuotas de referencia confirmadas contra la fuente oficial.",
    "",
    ...metrics.map(metricLine),
  ];
  return lines.join("\n");
}

function metricLine(m) {
  const tag =
    m.status === "measured" ? "MED" :
    m.status === "estimated" ? "EST" :
    m.status === "absent" ? "AUS" : "SIN ACCESO";
  const head = `${tag}  ${m.label}`;

  if (m.status === "absent") {
    return `${head}: ${m.absentReason ?? "sin datos"} · fuente: ${m.source}`;
  }
  if (m.status === "denied") {
    return `${head}: requiere permiso — ${m.deniedPermission ?? "no documentado"} · fuente: ${m.source}`;
  }

  const value = `${fmt(m.value ?? 0)} ${m.unit ?? ""}`.trim();
  let quotaPart = "";
  if (typeof m.quota === "number") {
    const pct = m.quota > 0 ? ((m.value ?? 0) / m.quota) * 100 : 0;
    const margin = m.quota - (m.value ?? 0);
    quotaPart = ` / ${fmt(m.quota)} (${pct.toFixed(1)}%) · margen ${fmt(margin)}${margin < 0 ? " (EXCEDIDO)" : ""}`;
  } else if (m.quotaPeriod) {
    quotaPart = ` · ${m.quotaPeriod}`;
  }
  const period = m.period ? ` · ${m.period}` : "";
  const reset = m.resetNote ? ` · ${m.resetNote}` : "";
  const updated = m.sourceUpdatedAt ? ` · datos al ${m.sourceUpdatedAt}` : "";
  return `${head}: ${value}${quotaPart}${period}${reset} · fuente: ${m.source}${updated}`;
}

function fmt(n) {
  return n.toLocaleString("es-MX");
}
