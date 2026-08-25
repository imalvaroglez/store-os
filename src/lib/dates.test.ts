import { describe, expect, it } from "vitest";
import { parseSpanishDate } from "./dates";

// Anchor "now" in a known Mexico City instant: 2026-08-22 10:00 CST.
const NOW = new Date("2026-08-22T16:00:00Z");

describe("parseSpanishDate", () => {
  it("label without year → most recent past occurrence", () => {
    expect(parseSpanishDate("ago 19", NOW)).toEqual({ iso: "2026-08-19", inferredYear: true });
  });

  it("label that would be in the future → previous year", () => {
    expect(parseSpanishDate("sep 30", NOW)).toEqual({ iso: "2025-09-30", inferredYear: true });
  });

  it("today in Mexico City counts as past", () => {
    expect(parseSpanishDate("ago 22", NOW)).toEqual({ iso: "2026-08-22", inferredYear: true });
  });

  it("explicit year is honored (2-digit and 4-digit)", () => {
    expect(parseSpanishDate("12 may 25", NOW)).toEqual({ iso: "2025-05-12", inferredYear: false });
    expect(parseSpanishDate("12 may 2025", NOW)).toEqual({ iso: "2025-05-12", inferredYear: false });
  });

  it("all Spanish months parse; no Date.parse involved", () => {
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    months.forEach((m, i) => {
      const out = parseSpanishDate(`${m} 15 2024`, NOW);
      expect(out?.iso).toBe(`2024-${String(i + 1).padStart(2, "0")}-15`);
    });
  });

  it("day-before-month labels parse fully (12 may 25 → 2025-05-12)", () => {
    expect(parseSpanishDate("12 may 25", NOW)).toEqual({ iso: "2025-05-12", inferredYear: false });
  });

  it("Mexico City day boundary is UTC-6, not the host machine's offset", () => {
    // 23:30 UTC = 17:30 in CDMX, same calendar day.
    expect(parseSpanishDate("ago 22", new Date("2026-08-22T23:30:00Z"))).toEqual({ iso: "2026-08-22", inferredYear: true });
    // 05:00 UTC = 23:00 the PREVIOUS day in CDMX → "ago 22" is already past.
    expect(parseSpanishDate("ago 22", new Date("2026-08-23T05:00:00Z"))).toEqual({ iso: "2026-08-22", inferredYear: true });
    // 2026-08-23T05:00Z is still Aug 22 in CDMX → "ago 23" is future there → previous year.
    expect(parseSpanishDate("ago 23", new Date("2026-08-23T05:00:00Z"))).toEqual({ iso: "2025-08-23", inferredYear: true });
  });

  it("rejects impossible dates (UTC round-trip)", () => {
    expect(parseSpanishDate("29 feb 2024", NOW)).toEqual({ iso: "2024-02-29", inferredYear: false });
    expect(parseSpanishDate("29 feb 2025", NOW)).toBeNull();
    expect(parseSpanishDate("31 abr 2026", NOW)).toBeNull();
    expect(parseSpanishDate("31 dic 2026", NOW)).toEqual({ iso: "2026-12-31", inferredYear: false });
  });

  it("rejects garbage", () => {
    expect(parseSpanishDate("hola mundo", NOW)).toBeNull();
    expect(parseSpanishDate("", NOW)).toBeNull();
  });
});
