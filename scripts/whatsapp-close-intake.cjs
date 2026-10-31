#!/usr/bin/env node
"use strict";

// Read-only evidence intake for an assisted monthly close. Message timestamps
// are local calendar labels, never inferred dates of sale, delivery or payment.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const DATE = "(\\d{1,4}[/.\\-]\\d{1,2}[/.\\-]\\d{1,4})";
const TIME = "(\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[ap]\\.?\\s*m\\.?)?)";
const IOS = new RegExp(`^\\[${DATE},?\\s+${TIME}\\]\\s*(.*)$`, "iu");
const ANDROID = new RegExp(`^${DATE},?\\s+${TIME}\\s+-\\s+(.*)$`, "iu");
const HEADER_LIKE = /^\[?\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}(?:[,\]\s]|$)/u;

function localTimestamp(dateText, timeText, dateOrder) {
  const parts = dateText.split(/[/.\-]/);
  let year, month, day;
  if (parts[0].length === 4) [year, month, day] = parts.map(Number);
  else {
    [day, month, year] = parts.map(Number);
    if (dateOrder === "mdy") [day, month] = [month, day];
    if (parts[2].length === 2) year += 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s*m\.?)?$/iu.exec(timeText);
  if (!time) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] ?? 0);
  if (minute > 59 || second > 59) return null;
  if (time[4]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (time[4].toLowerCase() === "p" ? 12 : 0);
  } else if (hour > 23) return null;
  const pad = (number) => String(number).padStart(2, "0");
  return { localDate: `${year}-${pad(month)}-${pad(day)}`, localTime: `${pad(hour)}:${pad(minute)}:${pad(second)}` };
}

function parseChat(text, { dateOrder, month, sourceName = "chat.txt", sourceSha256 = hash(text) }) {
  if (!["dmy", "mdy"].includes(dateOrder)) throw new Error("Indica el orden de las fechas: dmy o mdy.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Indica el mes como AAAA-MM.");
  const messages = [];
  const issues = [];
  let current = null;
  const lines = text.split(/\r\n|\n|\r/);
  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n");
    const separator = body.indexOf(": ");
    const sender = separator > 0 ? body.slice(0, separator) : null;
    const messageText = sender ? body.slice(separator + 2) : body;
    const message = {
      id: hash(`${sourceSha256}:${current.startLine}`).slice(0, 24),
      sourceName, startLine: current.startLine, endLine: current.endLine,
      ...current.timestamp, inMonth: current.timestamp.localDate.startsWith(month),
      sender, text: messageText, raw: current.raw.join("\n"),
      // An omitted attachment can contain product details or a payment receipt.
      attachmentMentioned: /(?:<[^>]*(?:omitid|omitted|adjunt|attached)[^>]*>|\b(?:archivo adjunto|file attached)|\b(?:imagen|image|audio|video|sticker|documento|document)\s+(?:omitid[oa]|omitted)\b)/iu.test(messageText),
      fingerprint: hash(JSON.stringify([current.timestamp.localDate, current.timestamp.localTime, sender, messageText])),
    };
    messages.push(message);
    current = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const clean = raw.replace(/^[\uFEFF\u200e\u200f\u202a-\u202e\u2066-\u2069]+/u, "");
    const header = IOS.exec(clean) ?? ANDROID.exec(clean);
    if (header) {
      flush();
      const timestamp = localTimestamp(header[1], header[2], dateOrder);
      if (!timestamp) {
        issues.push({ code: "invalid_timestamp", line: index + 1, raw, question: "Confirmar la fecha y hora de este mensaje." });
        continue;
      }
      current = { timestamp, startLine: index + 1, endLine: index + 1, body: [header[3]], raw: [raw] };
    } else if (HEADER_LIKE.test(clean)) {
      // Be conservative: an unfamiliar export header must not silently attach
      // a different sender, date or payment statement to the preceding message.
      flush();
      issues.push({ code: "unsupported_header", line: index + 1, raw, question: "Revisar este posible encabezado: su formato no se pudo leer." });
    } else if (current) {
      current.body.push(raw);
      current.raw.push(raw);
      current.endLine = index + 1;
    } else if (raw.trim()) {
      issues.push({ code: "unparsed_line", line: index + 1, raw, question: "Revisar este texto: no se pudo asociar a un mensaje con fecha." });
    }
  }
  flush();
  const seen = new Map();
  for (const message of messages) {
    if (seen.has(message.fingerprint)) issues.push({ code: "possible_duplicate", messageId: message.id, otherMessageId: seen.get(message.fingerprint), question: "Comprobar si son mensajes repetidos; ambos se conservan." });
    else seen.set(message.fingerprint, message.id);
  }
  if (!messages.length) issues.push({ code: "no_messages", question: "Revisar el formato o aportar una exportación de texto del chat." });
  return {
    version: 1, month, dateOrder, sourceName, sourceSha256,
    timestampMeaning: "Fecha local del mensaje; no confirma fecha de venta, entrega ni cobro.",
    messages, issues,
    counts: { messages: messages.length, inMonth: messages.filter((m) => m.inMonth).length, attachmentMentions: messages.filter((m) => m.attachmentMentioned).length, issues: issues.length },
  };
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Preserve the exact evidence in JSON; keep spreadsheet imports from treating
  // sender-controlled text as formulas. Every column is quoted for multiline CSV.
  if (/^[\s\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069\uFEFF]*[=+@\-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function messagesCsv(report) {
  const rows = [["Referencia", "Archivo", "Línea inicial", "Línea final", "Fecha del mensaje", "Hora local", "Remitente del texto", "Mensaje", "Menciona archivo", "Mensaje del mes"]];
  for (const m of report.messages) rows.push([m.id, m.sourceName, m.startLine, m.endLine, m.localDate, m.localTime, m.sender, m.text, m.attachmentMentioned ? "Sí" : "No", m.inMonth ? "Sí" : "No"]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function writeIntake(input, outDir, options) {
  const inputPath = fs.realpathSync(input);
  const buffer = fs.readFileSync(inputPath);
  if (buffer.includes(0)) throw new Error("Se necesita un chat de texto UTF-8 (.txt), no un ZIP ni una copia de seguridad.");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  const report = parseChat(text, { ...options, sourceName: path.basename(inputPath), sourceSha256: hash(buffer) });
  if (hash(fs.readFileSync(inputPath)) !== report.sourceSha256) throw new Error("El chat cambió durante la lectura. Vuelve a exportarlo.");
  fs.mkdirSync(path.dirname(path.resolve(outDir)), { recursive: true });
  // Never replace a previous intake or an existing source directory.
  fs.mkdirSync(outDir, { mode: 0o700 });
  const write = (name, contents) => fs.writeFileSync(path.join(outDir, name), contents, { flag: "wx", mode: 0o600 });
  write("mensajes.json", JSON.stringify(report, null, 2) + "\n");
  write("mensajes.csv", messagesCsv(report));
  write("revision.md", [
    `# Captura asistida de ${report.month}`, "",
    `Mensajes leídos: ${report.counts.messages}. Mensajes fechados en el mes: ${report.counts.inMonth}.`,
    `Referencias a archivos: ${report.counts.attachmentMentions}. Incidencias de lectura: ${report.counts.issues}.`, "",
    "Se conservan los mensajes de otros meses como contexto. La fecha del mensaje no determina el mes de una venta o un cobro.",
    "Esta lectura prepara evidencia; todavía no calcula ventas, cobros ni reparto.", "",
    "## Trabajo de captura", "",
    "1. Reconstruir cada pedido y sus cambios con referencias al mensaje y líneas originales.",
    "2. Separar cotización, venta confirmada, entrega, cobro anunciado y cobro confirmado.",
    "3. Comparar con el Excel existente antes de agregar una venta; no eliminar coincidencias por nombre o importe.",
    "4. Revisar fotos, audios o comprobantes que contengan datos necesarios y no estén en el texto.",
    "5. Preguntar únicamente por fechas, costos, cantidades, pagos o devoluciones que no se puedan comprobar.",
    "6. Completar una copia del Excel con las operaciones revisadas y preparar el corte con la base acordada.", "",
    "Los originales permanecen sin cambios. Los mensajes y las clientas se conservan fuera de Git.", "",
  ].join("\n"));
  return report;
}

function main(args) {
  if (args.includes("--help")) {
    console.log("Uso: node scripts/whatsapp-close-intake.cjs --input chat.txt --month 2026-10 --date-order dmy --out .local/monthly-close/chat-01");
    return;
  }
  const allowed = new Set(["--input", "--month", "--date-order", "--out"]);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!allowed.has(flag) || !args[index + 1] || args[index + 1].startsWith("--") || options[flag]) throw new Error("Argumentos incompletos o repetidos. Consulta --help.");
    options[flag] = args[index + 1];
  }
  if ([...allowed].some((flag) => !options[flag])) throw new Error("Faltan argumentos. Consulta --help.");
  const report = writeIntake(options["--input"], options["--out"], { month: options["--month"], dateOrder: options["--date-order"] });
  console.log(`Lectura terminada: ${report.counts.messages} mensajes, ${report.counts.issues} incidencias. Revisión en ${path.resolve(options["--out"])}`);
  if (report.issues.some((issue) => ["invalid_timestamp", "unsupported_header", "unparsed_line", "no_messages"].includes(issue.code))) process.exitCode = 2;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`No se pudo preparar la captura: ${error.message}`); process.exitCode = 1; }
}

module.exports = { parseChat, messagesCsv, writeIntake };
