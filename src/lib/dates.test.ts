import { describe, expect, it } from "vitest";
import { formatDate, parseSpanishDate, todayIso } from "./dates";

// Construct a local wall-clock time, independent of the test runner's zone.
const NOW = new Date(2026, 7, 22, 10, 0);

describe("parseSpanishDate", () => {
  it("label without year → most recent past occurrence", () => {
    expect(parseSpanishDate("ago 19", NOW)).toEqual({ iso: "2026-08-19", inferredYear: true });
  });

  it("label that would be in the future → previous year", () => {
    expect(parseSpanishDate("sep 30", NOW)).toEqual({ iso: "2025-09-30", inferredYear: true });
  });

  it("today in the device's local zone counts as past", () => {
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

  it("uses local midnight when inferring a ticket's year", () => {
    expect(parseSpanishDate("ago 22", new Date(2026, 7, 22, 23, 30))).toEqual({ iso: "2026-08-22", inferredYear: true });
    expect(parseSpanishDate("ago 23", new Date(2026, 7, 22, 23, 30))).toEqual({ iso: "2025-08-23", inferredYear: true });
    expect(parseSpanishDate("ago 23", new Date(2026, 7, 23, 0, 30))).toEqual({ iso: "2026-08-23", inferredYear: true });
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


describe("local calendar dates", () => {
  it("changes the purchase date at the device's local midnight", () => {
    expect(todayIso(new Date(2026, 9, 30, 23, 59, 59))).toBe("2026-10-30");
    expect(todayIso(new Date(2026, 9, 31, 0, 0, 0))).toBe("2026-10-31");
  });
  it("keeps the day of a date-only ticket when formatting it", () => {
    expect(formatDate("2026-10-30")).toMatch(/^30 oct\.? 2026$/);
  });
  it("shows saved UTC instants on the device's local day", () => {
    expect(formatDate(new Date(2026, 9, 30, 23, 30).toISOString())).toMatch(/^30 oct\.? 2026$/);
    expect(formatDate(new Date(2026, 9, 31, 0, 30).toISOString())).toMatch(/^31 oct\.? 2026$/);
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("invalid")).toBe("");
  });
});
