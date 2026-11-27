// #488 — shared contract for the projection-flake probe.
//
// The provider emits markers through projectionProbeMarker(); the e2e spec
// classifies them with classifyProjectionFailure(). Keeping BOTH sides in one
// module pins the string contract: a rewording here breaks a unit test, not
// the next real flake occurrence.
//
// Clock assumption: the classifier compares its own Date.now() with the ts=
// stamps the BROWSER emitted. They only mix legitimately because the spec
// runs browser and runner on the same host (CI included); a remote browser
// would need a clock offset — out of scope for this instrument.

export const PROJECTION_PROBE_PREFIX = "#488-PROJ-WRITE";

export type ProjectionProbeKind = "heartbeat" | "channel" | "start" | "ok" | "threw";

export function projectionProbeMarker(
  kind: ProjectionProbeKind,
  label: string,
  extra: { err?: unknown } = {}
): string {
  const ts = Date.now();
  if (kind === "threw") {
    const error = extra.err as { code?: string; name?: string; message?: string } | undefined;
    const detail = error?.code ? `code=${error.code}` : `${error?.name ?? "Error"}: ${(error?.message ?? String(extra.err)).slice(0, 120)}`;
    return `${PROJECTION_PROBE_PREFIX}[${label}] threw ts=${ts} err=${detail}`;
  }
  return `${PROJECTION_PROBE_PREFIX}[${label}] ${kind} ts=${ts}`;
}

type Flight = { label: string; startedAt?: number; ok: boolean; threw: string | null };

function parseFlights(markers: string[]): Flight[] {
  const byLabel = new Map<string, Flight>();
  for (const marker of markers) {
    if (!marker.includes(PROJECTION_PROBE_PREFIX)) continue;
    const label = (marker.match(/\[([^\]]+)\]/) ?? [])[1] ?? "?";
    if (label === "heartbeat" || label === "channel") continue;
    const ts = Number((marker.match(/ts=(\d+)/) ?? [])[1]);
    const flight = byLabel.get(label) ?? { label, ok: false, threw: null };
    if (marker.includes(" start ts=")) {
      // A later start for the same label is a NEW flight (retry): reset it.
      byLabel.set(label, { label, startedAt: Number.isFinite(ts) ? ts : undefined, ok: false, threw: null });
      continue;
    }
    if (marker.includes(" ok ts=")) flight.ok = true;
    if (marker.includes(" threw ts=")) flight.threw = marker;
    byLabel.set(label, flight);
  }
  return [...byLabel.values()];
}

/**
 * Classify a projection-poll failure from the captured probe markers, per
 * label and per flight. `watchedLabel` is the write the flake suspects (the
 * spec passes the availability republish label); other labels' flights are
 * reported but never masquerade as the watched one.
 *
 * The channel discrimination relies on the [channel] marker — emitted BY THE
 * SPEC from the same document the write runs in, at attach time. A heartbeat
 * from a later navigation cannot prove anything about the write's document,
 * so "never fired" vs "record lost" is decided by the channel marker alone.
 */
export function classifyProjectionFailure(
  markers: string[],
  lastReadStatus: number,
  budgetMs: number,
  watchedLabel?: string
): string {
  const flights = parseFlights(markers);
  const channelAlive = markers.some((m) => m.includes("[channel]"));
  const watched = (watchedLabel ? flights.filter((f) => f.label === watchedLabel) : flights).filter((f) => f.startedAt !== undefined);
  const flight = watched[watched.length - 1];

  if (flight?.threw) return `ESCRITURA INTERRUMPIDA [${flight.label}] (${flight.threw.slice(0, 130)})`;
  if (flight?.ok) return `ESCRITURA OK [${flight.label}], FALLO DE LECTURA (último status del sondeo: ${lastReadStatus})`;
  if (flight) {
    const elapsed = Date.now() - (flight.startedAt ?? Date.now());
    const seconds = Math.round(elapsed / 1000);
    // The verdict prints after the poll budget is spent, so a flight still
    // unresolved within ~1.5x the budget reads as in-flight only when it
    // started late (e.g. a retry); older ones are stuck.
    if (elapsed < budgetMs * 1.5) return `ESCRITURA EN CURSO [${flight.label}] (iniciada hace ${seconds}s; presupuesto del sondeo ${Math.round(budgetMs / 1000)}s)`;
    return `ESCRITURA ATASCADA [${flight.label}] (iniciada hace ${seconds}s sin resolución)`;
  }
  if (channelAlive) return `ESCRITURA NUNCA SE DISPARÓ (canal probado en el mismo documento${watchedLabel ? ` para [${watchedLabel}]` : ""}; sin arranque)`;
  return "REGISTRO PERDIDO (sin marca de canal: nada llegó del documento de la escritura — consola, listener o navegación)";
}
