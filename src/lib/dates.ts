// Date formatting helpers (Spanish, Mexico).

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Spanish-month date labels ("ago 19", "12 may 25") → ISO dates.
// Single client-side authority: the parser only emits the raw label.
// No Date.parse — Spanish month names are not reliably locale-parsed.
// Mexico City is a flat UTC-6 (no DST since 2022).
const MONTHS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

/**
 * Parse "ago 19" / "12 may 25" / "ene 15 2024" style labels.
 * Without a year, picks the MOST RECENT PAST occurrence in Mexico City time
 * (supplier receipts are for goods already purchased).
 * Returns ISO "YYYY-MM-DD" and whether the year was inferred.
 */
export function parseSpanishDate(label: string, now = new Date()): { iso: string; inferredYear: boolean } | null {
  // Day may precede or follow the month; a trailing 2-4 digit number after
  // a day is the year.
  const m = label.trim().match(/^(?:(\d{1,2})\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s*(?:(\d{1,2})\s+)?(?:(\d{2,4}))?\s*$/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  // A lone trailing number is the day ("ago 19"); it only counts as the year
  // when a day already appeared before/after the month ("12 may 25").
  const day = m[1] ? parseInt(m[1], 10) : m[3] ? parseInt(m[3], 10) : m[4] ? parseInt(m[4], 10) : NaN;
  if (!month || !(day >= 1 && day <= 31)) return null;
  let year = m[4] && (m[1] || m[3]) ? parseInt(m[4], 10) : undefined;
  const inferredYear = year === undefined;
  if (year !== undefined && year < 100) year += 2000;

  // "Now" in Mexico City terms.
  const nowUtc = now.getTime() + now.getTimezoneOffset() * 60000;
  const nowMx = new Date(nowUtc - 360 * 60000);
  const yNow = nowMx.getUTCFullYear();

  if (!inferredYear) {
    return { iso: isoOf(year!, month, day), inferredYear };
  }
  // Most recent past: this year if not in the future, else the previous year.
  const thisYear = isoOf(yNow, month, day);
  const today = isoOf(yNow, nowMx.getUTCMonth() + 1, nowMx.getUTCDate());
  if (thisYear <= today) return { iso: thisYear, inferredYear };
  return { iso: isoOf(yNow - 1, month, day), inferredYear };
}

function isoOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
