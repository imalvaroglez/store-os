import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

const { parseChat, messagesCsv, writeIntake } = createRequire(import.meta.url)("../../scripts/whatsapp-close-intake.cjs");
const options = { dateOrder: "dmy", month: "2026-10" };

describe("WhatsApp evidence intake", () => {
  it("preserves multiline Android messages, source lines and previous-month context", () => {
    const text = "30/09/2026, 23:50 - Clienta: Quisiera dos anillos\n¿Hay dorados?\n31/10/2026, 14:05 - Tienda: Recibido\n";
    const report = parseChat(text, options);
    expect(report.messages).toHaveLength(2);
    expect(report.messages[0]).toMatchObject({ startLine: 1, endLine: 2, text: "Quisiera dos anillos\n¿Hay dorados?", inMonth: false });
    expect(report.messages[1]).toMatchObject({ localDate: "2026-10-31", localTime: "14:05:00", inMonth: true });
    expect(report.messages.map((m: { raw: string }) => m.raw).join("\n")).toBe(text);
    expect(report.counts.inMonth).toBe(1);
  });

  it("reads iOS exports with direction marks, Spanish clocks and omitted media", () => {
    const report = parseChat("\u200e[31/10/26, 12:04:03\u202fa.\u00a0m.] Clienta: <adjunto: foto.jpg>\r\n[31/10/26, 1:05:06 p. m.] Tienda: imagen omitida", options);
    expect(report.messages[0]).toMatchObject({ localTime: "00:04:03", attachmentMentioned: true });
    expect(report.messages[1]).toMatchObject({ localTime: "13:05:06", attachmentMentioned: true });
    expect(report.counts.attachmentMentions).toBe(2);
  });

  it("requires date order and does not guess ambiguous dates or timezone", () => {
    const text = "10/11/26, 09:00 - Tienda: Mensaje";
    expect(() => parseChat(text, { month: "2026-10" })).toThrow("orden");
    expect(parseChat(text, options).messages[0].localDate).toBe("2026-11-10");
    expect(parseChat(text, { ...options, dateOrder: "mdy" }).messages[0].localDate).toBe("2026-10-11");
    expect(parseChat(text, options).messages[0]).not.toHaveProperty("occurredAt");
  });

  it("keeps invalid dates and text before a header as explicit issues", () => {
    const report = parseChat("Texto sin fecha\n31/02/2026, 10:00 - Clienta: Pago\nMás texto\n31/10/2026, 24:00 - Tienda: Otro", options);
    expect(report.messages).toHaveLength(0);
    expect(report.issues.map((i: { code: string }) => i.code)).toEqual(["unparsed_line", "invalid_timestamp", "unparsed_line", "invalid_timestamp", "no_messages"]);
    expect(report.issues[1].raw).toContain("31/02/2026");
  });

  it("keeps repeated messages and payment promises without turning them into transactions", () => {
    const text = "31/10/2026, 10:00 - Clienta: Te transfiero $500 mañana";
    const report = parseChat(text + "\n" + text, options);
    expect(report.messages).toHaveLength(2);
    expect(report.messages[0].id).not.toBe(report.messages[1].id);
    expect(report.issues[0].code).toBe("possible_duplicate");
    expect(report).not.toHaveProperty("sales");
    expect(report).not.toHaveProperty("payments");
  });

  it("protects spreadsheet imports from formula injection without changing JSON evidence", () => {
    const report = parseChat('31/10/2026, 10:00 - =Nombre: =HYPERLINK("x")\nsegunda línea', options);
    expect(report.messages[0].text).toBe('=HYPERLINK("x")\nsegunda línea');
    const csv = messagesCsv(report);
    expect(csv).toContain('"\'=Nombre"');
    expect(csv).toContain('"\'=HYPERLINK(""x"")\nsegunda línea"');
  });

  it("writes a review package, leaves the source untouched, and refuses to replace an existing package", () => {
    const directory = mkdtempSync(join(tmpdir(), "close-intake-test-"));
    try {
      const input = join(directory, "chat.txt");
      const output = join(directory, "revision");
      const text = "31/10/2026, 15:00 - Tienda: Cotización de ejemplo";
      writeFileSync(input, text);
      const report = writeIntake(input, output, options);
      expect(report.counts.messages).toBe(1);
      expect(readFileSync(input, "utf8")).toBe(text);
      expect(JSON.parse(readFileSync(join(output, "mensajes.json"), "utf8")).sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(join(output, "mensajes.csv"))).toBe(true);
      expect(readFileSync(join(output, "revision.md"), "utf8")).toContain("cobro confirmado");
      expect(() => writeIntake(input, output, options)).toThrow();
      expect(readFileSync(input, "utf8")).toBe(text);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid text encoding before generating a package", () => {
    const directory = mkdtempSync(join(tmpdir(), "close-intake-test-"));
    try {
      const input = join(directory, "chat.txt");
      const output = join(directory, "revision");
      writeFileSync(input, Buffer.from([0xc3, 0x28]));
      expect(() => writeIntake(input, output, options)).toThrow();
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns a non-success CLI status while preserving evidence of an unreadable date", () => {
    const directory = mkdtempSync(join(tmpdir(), "close-intake-test-"));
    try {
      const input = join(directory, "chat.txt");
      const output = join(directory, "revision");
      writeFileSync(input, "31/02/2026, 10:00 - Clienta: Texto que debe revisarse");
      const result = spawnSync(process.execPath, ["scripts/whatsapp-close-intake.cjs", "--input", input, "--month", "2026-10", "--date-order", "dmy", "--out", output], { encoding: "utf8" });
      expect(result.status).toBe(2);
      const report = JSON.parse(readFileSync(join(output, "mensajes.json"), "utf8"));
      expect(report.issues[0].raw).toContain("Texto que debe revisarse");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
