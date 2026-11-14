#!/usr/bin/env node
// #191 — fase 1: reporte MANUAL, local, privado y de solo lectura del consumo
// de los servicios que Store OS realmente usa. Cero infraestructura nueva:
// consulta APIs ya habilitadas con la autenticación local existente (gcloud
// del dueño + gh), imprime SOLO en la terminal y no persiste nada.
//
// Uso: npm run usage-report
//
// Conectores y su estado de permisos:
// - Firestore (dev y prod): métricas oficiales `billable_read_units` /
//   `billable_write_units` de Cloud Monitoring (monitoring.googleapis.com ya
//   habilitado; credenciales de `gcloud auth print-access-token`).
// - Storage: tamaño/número de objetos vía `gcloud storage du -s` (agregado,
//   nunca lee contenidos).
// - GitHub Actions: `gh api` repos/{owner}/{repo}/actions/usage.
// - Vercel: AUSENTE salvo VERCEL_TOKEN en el entorno (no se guarda nada).
// - Auth (número de cuentas): AUSENTE por diseño — leer perfiles está fuera
//   de esta etapa; no hay métrica agregada pública sin Admin SDK.

import { execFileSync } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { buildUsageReport } from "./usage-report-lib.mjs";

const PROJECTS = ["store-os-dev", "store-os-f7cf8"];
const REPO = "imalvaroglez/store-os";

// Quotas de referencia (fuente oficial; confirmar edición/plan/vigencia):
const FIRESTORE_DAILY_READ = 50_000;
const FIRESTORE_DAILY_WRITE = 20_000;
const FIRESTORE_DAILY_DELETE = 20_000;
const FIRESTORE_STORAGE_GIB = 1; // por base con cuota sin costo
const STORAGE_FREE_GB = 5; // por bucket (región us-east1)
const PACIFIC_RESET = "reinicia en horario del Pacífico (PT)";

function sh(cmd, args) {
  try {
    // stderr silenciado: los avisos del SDK no son parte del reporte.
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (error) {
    return { __error: String((error && error.message) || error) };
  }
}

function monitoringQuery(token, project, filter, minutes) {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60_000);
  const params = new URLSearchParams({
    filter,
    "interval.startTime": start.toISOString(),
    "interval.endTime": end.toISOString(),
  });
  const path = `/v3/projects/${project}/timeSeries?${params.toString()}`;
  return new Promise((resolve) => {
    const req = httpsRequest(
      { hostname: "monitoring.googleapis.com", path, method: "GET", headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve({ ok: res.statusCode === 200, status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ ok: false, status: res.statusCode, data: null });
          }
        });
      }
    );
    req.on("error", (error) => resolve({ ok: false, status: 0, error: String(error) }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, error: "timeout" }); });
    req.end();
  });
}

function sumTimeSeries(data) {
  let total = 0;
  for (const series of data?.timeSeries ?? []) {
    for (const point of series.points ?? []) {
      const v = point.value?.int64Value ?? point.value?.doubleValue;
      if (typeof v === "number") total += v;
      else if (typeof v === "string" && v !== "") total += Number(v) || 0;
    }
  }
  return total;
}

async function main() {
  const metrics = [];
  const token = sh("gcloud", ["auth", "print-access-token"]);
  const tokenOk = typeof token === "string" && !token.__error;

  for (const project of PROJECTS) {
    if (!tokenOk) {
      metrics.push({ id: `${project}.firestore`, label: `Firestore ${project}`, status: "denied", deniedPermission: "gcloud autenticado (gcloud auth login)", source: "Cloud Monitoring API" });
      continue;
    }
    // Dos capas, en orden de preferencia:
    // 1) billable_read/write_units (la UNIDAD de la cuota) — en proyectos que
    //    no son Firestore Enterprise suele venir VACÍA (espera realista: esta
    //    capa caerá a EST); si trae series, es la cifra medida oficial.
    // 2) api/request_count agrupada por método — API-requests medidos que
    //    funcionan como COTA INFERIOR de unidades facturables (cada request
    //    toca ≥1 documento) → se reportan como ESTIMADO, nunca como la cuota exacta.
    const sumMethod = (data, methods) => {
      let total = 0;
      for (const series of data?.timeSeries ?? []) {
        const method = series.metric?.labels?.api_method ?? "";
        if (!methods.includes(method)) continue;
        for (const point of series.points ?? []) {
          // int64Value llega como CADENA en el JSON de Monitoring.
          const v = point.value?.int64Value ?? point.value?.doubleValue;
          const n = typeof v === "string" && v !== "" ? Number(v) : v;
          if (typeof n === "number" && Number.isFinite(n)) total += n;
        }
      }
      return total;
    };
    const READ_METHODS = ["RunQuery", "RunAggregationQuery", "GetDocument", "BatchGetDocuments", "ListDocuments", "ListCollectionIds", "Listen"];
    const WRITE_METHODS = ["Commit", "CreateDocument"];

    const billableRead = await monitoringQuery(token, project, 'metric.type="firestore.googleapis.com/api/billable_read_units"', 24 * 60);
    const billableWrite = await monitoringQuery(token, project, 'metric.type="firestore.googleapis.com/api/billable_write_units"', 24 * 60);
    const requests = await monitoringQuery(token, project, 'metric.type="firestore.googleapis.com/api/request_count"', 30 * 24 * 60);
    const requestReads = requests.ok ? sumMethod(requests.data, READ_METHODS) : null;
    const requestWrites = requests.ok ? sumMethod(requests.data, WRITE_METHODS) : null;
    const billableReadHasData = billableRead.ok && (billableRead.data?.timeSeries?.length ?? 0) > 0;
    const billableWriteHasData = billableWrite.ok && (billableWrite.data?.timeSeries?.length ?? 0) > 0;

    const dayReads = billableReadHasData
      ? { ok: true, mode: "measured", total: sumTimeSeries(billableRead.data), source: "Cloud Monitoring API · billable_read_units (unidades de la cuota; métrica RETRASADA)" }
      : requests.ok
        ? { ok: true, mode: "estimated", total: requestReads, source: "Cloud Monitoring API · request_count por método (COTA INFERIOR de lecturas; no es la unidad exacta de la cuota)" }
        : { ok: false, status: requests.status };
    const dayWrites = billableWriteHasData
      ? { ok: true, mode: "measured", total: sumTimeSeries(billableWrite.data), source: "Cloud Monitoring API · billable_write_units (unidades de la cuota; métrica RETRASADA)" }
      : requests.ok
        ? { ok: true, mode: "estimated", total: requestWrites, source: "Cloud Monitoring API · request_count por método (COTA INFERIOR de escrituras; no es la unidad exacta de la cuota)" }
        : { ok: false, status: requests.status };
    const DAY_PERIOD = "últimas 24 h (ventana móvil; la cuota reinicia a medianoche PT — justo tras el reinicio la ventana puede exagerar)";
    const unitFor = (mode, what) =>
      mode === "measured" ? `unidades de cuota (${what})` : `solicitudes (cota inferior de ${what})`;
    if (dayReads.ok) {
      metrics.push({ id: `${project}.reads.day`, label: `Firestore ${project} · lecturas`, status: dayReads.mode, value: dayReads.total, unit: unitFor(dayReads.mode, "lecturas"), period: DAY_PERIOD, quota: FIRESTORE_DAILY_READ, resetNote: PACIFIC_RESET, source: dayReads.source, sourceUpdatedAt: new Date().toISOString() });
    } else {
      metrics.push({ id: `${project}.reads.day`, label: `Firestore ${project} · lecturas`, status: "denied", deniedPermission: `monitoring.googleapis.com (${dayReads.status})`, source: "Cloud Monitoring API" });
    }
    if (dayWrites.ok) {
      metrics.push({ id: `${project}.writes.day`, label: `Firestore ${project} · escrituras`, status: dayWrites.mode, value: dayWrites.total, unit: unitFor(dayWrites.mode, "escrituras"), period: DAY_PERIOD, quota: FIRESTORE_DAILY_WRITE, resetNote: PACIFIC_RESET, source: dayWrites.source, sourceUpdatedAt: new Date().toISOString() });
    } else {
      // MAYOR-1 (r2): a failed writes probe is REPORTED, never silently
      // dropped — the 20K/day quota line must stay visible as SIN ACCESO.
      metrics.push({ id: `${project}.writes.day`, label: `Firestore ${project} · escrituras`, status: "denied", deniedPermission: `monitoring.googleapis.com (${dayWrites.status})`, source: "Cloud Monitoring API" });
    }
    if (requestReads !== null) {
      metrics.push({ id: `${project}.reads.month`, label: `Firestore ${project} · lecturas (tendencia)`, status: "estimated", value: requestReads, unit: "solicitudes", period: "últimos 30 días", quotaPeriod: "sin cuota mensual (la cuota es diaria)", source: "Cloud Monitoring API · request_count (cota inferior)", sourceUpdatedAt: new Date().toISOString() });
    }
    // Borrados (r2): document/delete_ops_count SÍ existe como métrica pública —
    // se consulta en vez de declararla ausente con premisa falsa.
    const deleteOps = await monitoringQuery(token, project, 'metric.type="firestore.googleapis.com/document/delete_ops_count"', 24 * 60);
    if (deleteOps.ok) {
      const deletesTotal = sumTimeSeries(deleteOps.data);
      metrics.push({ id: `${project}.deletes`, label: `Firestore ${project} · borrados`, status: "measured", value: deletesTotal, unit: "unidades de cuota (borrados)", period: DAY_PERIOD, quota: FIRESTORE_DAILY_DELETE, resetNote: PACIFIC_RESET, source: "Cloud Monitoring API · document/delete_ops_count", sourceUpdatedAt: new Date().toISOString() });
    } else {
      metrics.push({ id: `${project}.deletes`, label: `Firestore ${project} · borrados`, status: "denied", deniedPermission: `monitoring.googleapis.com (${deleteOps.status})`, source: "Cloud Monitoring API" });
    }
    metrics.push({ id: `${project}.storage-doc`, label: `Firestore ${project} · almacenado`, status: "absent", absentReason: "requiere exportación de facturación (no habilitada; cero costo)", source: "—" });
  }

  // Storage (buckets de los proyectos): agregado sin leer contenidos.
  for (const [project, bucket] of [["dev", "store-os-dev.firebasestorage.app"], ["prod", "store-os-f7cf8.firebasestorage.app"]]) {
    const du = sh("gcloud", ["storage", "du", "-s", `gs://${bucket}`]);
    if (typeof du === "string" && !du.__error) {
      const [bytes, objects] = du.split(/\s+/);
      const gb = Number(bytes) / 1e9;
      metrics.push({ id: `storage.${project}`, label: `Storage ${project} · bucket`, status: "measured", value: Math.round(gb * 100) / 100, unit: "GB", quota: STORAGE_FREE_GB, period: "ahora", source: "gcloud storage du (agregado)", sourceUpdatedAt: new Date().toISOString() });
    } else {
      metrics.push({ id: `storage.${project}`, label: `Storage ${project} · bucket`, status: "denied", deniedPermission: "roles/storage.objectViewer + storage.googleapis.com", source: "gcloud storage" });
    }
  }

  // GitHub Actions (r2): NO existe endpoint público de uso por repositorio —
  // /repos/{repo}/actions/usage responde 404 real (verificado por la revisión).
  // El endpoint de facturación (/users/{u}/settings/billing/actions) exige
  // ampliar el token a scope «user»; conectarlo queda como decisión del PO.
  metrics.push({ id: "gha", label: "GitHub Actions · minutos", status: "absent", absentReason: "sin endpoint público por repositorio (el de facturación requiere token con scope «user»; conectarlo es decisión del PO)", source: "API de GitHub (sin consulta)" });

  // Vercel: solo con token explícito en el entorno (nunca se guarda).
  if (process.env.VERCEL_TOKEN) {
    metrics.push({ id: "vercel", label: "Vercel · uso", status: "absent", absentReason: "VERCEL_TOKEN detectado pero sin conector en esta fase (nada consultado; cero no afirmado)", source: "—" });
  } else {
    metrics.push({ id: "vercel", label: "Vercel · uso", status: "absent", absentReason: "sin VERCEL_TOKEN local (no se guardan credenciales)", source: "—" });
  }

  // Auth: número de cuentas — fuera por diseño (no leer perfiles).
  metrics.push({ id: "auth", label: "Auth · cuentas", status: "absent", absentReason: "no hay métrica agregada pública sin Admin SDK; leer perfiles queda fuera de esta etapa", source: "—" });

  console.log(buildUsageReport(metrics, { generatedAt: new Date().toISOString() }));
}

main().catch((error) => {
  console.error("No se pudo generar el reporte:", String(error));
  process.exitCode = 1;
});
