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

  it("rejects garbage", () => {
    expect(parseSpanishDate("hola mundo", NOW)).toBeNull();
    expect(parseSpanishDate("", NOW)).toBeNull();
  });
});
