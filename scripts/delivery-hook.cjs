#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}

function rootFrom(input) {
  const candidate = path.resolve(input.cwd || path.join(__dirname, ".."));
  const result = spawnSync("git", ["-C", candidate, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return result.status === 0 ? path.resolve(result.stdout.trim()) : candidate;
}

function gitBranch(root) {
  return spawnSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).stdout?.trim() || "";
}

function runGate(root, kind) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "delivery-harness.cjs"), "gate", kind], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
  });
}

function gitCommand(command, subcommand) {
  const git = String.raw`(?:^|[;&|]\s*|\s)(?:\/[^\s;&|]+\/)?git\b[^\n;&|]*`;
  const literal = new RegExp(`${git}(?:^|\\s)${subcommand}(?:\\s|$)`, "i");
  const alias = new RegExp(`${git}alias\\.[^=\\s]+=${subcommand}\\b`, "i");
  return literal.test(command) || alias.test(command);
}

function parseContract(message, requireReviewer = false) {
  if (typeof message !== "string" || !message.trim()) return null;
  let value;
  try { value = JSON.parse(message); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!new Set(["PASS", "FAIL", "BLOCKED"]).has(value.status)) return null;
  if (typeof value.summary !== "string" || !value.summary.trim()) return null;
  if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.some((entry) => typeof entry !== "string" || !entry.trim())) return null;
  if (!Array.isArray(value.findings)) return null;
  if (requireReviewer && (!value.reviewer || typeof value.reviewer.id !== "string" || !value.reviewer.id.trim() ||
      value.reviewer.profile !== "store-os-reviewer" || typeof value.reviewer.lens !== "string" || !value.reviewer.lens)) return null;
  return value;
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function persistReceipt(root, input, value) {
  const pointer = path.join(root, ".delivery", "runs", "active.json");
  let directory;
  if (fs.existsSync(pointer)) {
    const { runId } = JSON.parse(fs.readFileSync(pointer, "utf8"));
    if (!runId) return false;
    directory = path.join(root, ".delivery", "runs", runId, "receipts");
  } else {
    const manifestFile = path.join(root, ".delivery", "bootstrap.json");
    if (!fs.existsSync(manifestFile)) return false;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (gitBranch(root) !== manifest.branch) return false;
    directory = path.join(root, ".delivery", "runs", "bootstrap", "receipts");
  }
  const sha = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  if (!sha) return false;
  const receipt = {
    agentId: input.agent_id,
    agentType: input.agent_type,
    resultHash: canonicalHash(value),
    sha,
    transcriptPath: input.agent_transcript_path || null,
    recordedAt: new Date().toISOString(),
  };
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${receipt.resultHash}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  return true;
}

function forbiddenCommand(command, root) {
  const value = command.replaceAll("\\\n", " ");
  if (/\bgit\b[^\n;&|]*(?:-c\s+alias\.|--config-env(?:=|\s+)alias\.)/i.test(value)) return "Los aliases Git están bloqueados por política de entrega.";
  if (/\bgit\b[^\n;&|]*\bsend-pack\b/i.test(value) ||
      /\bgit(?:\s+(?:-C|-c|--git-dir|--work-tree)\s+\S+|\s+--[^\s]+)*\s+(?:["']?\$|`)/i.test(value)) {
    return "Los comandos Git dinámicos o send-pack eluden los gates y están bloqueados.";
  }
  if (/\bgh\s+api\b/i.test(value)) return "gh api está bloqueado; usa los comandos PR cubiertos por el harness.";
  if (/\bgh\b[^\n;&|]*\b(?:run\s+(?:rerun|cancel|delete)|workflow\s+(?:run|enable|disable))\b/i.test(value)) {
    return "Los agentes no pueden iniciar, relanzar, cancelar ni borrar ejecuciones de GitHub Actions.";
  }
  if (/\bgh\s+repo\s+sync\b/i.test(value)) return "gh repo sync puede mover refs sin gate y está bloqueado.";
  if (/\bgh\s+pr\s+review\b/i.test(value)) return "Los agentes no pueden aprobar ni revisar PRs como autoridad humana.";
  if (gitCommand(value, "merge") || /\bgh\s+pr\s+(merge|ready)\b/i.test(value)) {
    return "Merge y marcar el PR ready requieren acción humana.";
  }
  const pushes = gitCommand(value, "push");
  const targetsMain = /(?:^|\s)\+?(?:\S*:)?(?:refs\/heads\/)?main(?:\s|$)/i.test(value);
  if ((pushes && (targetsMain || /(?:^|\s)--(?:mirror|all)(?:\s|$)/i.test(value))) ||
      (pushes && gitBranch(root) === "main")) {
    return "Nunca se permite push directo a main.";
  }
  if (/\bvercel\b/i.test(value) ||
      /\bfirebase\s+[^\n;&|]*\bdeploy\b/i.test(value) ||
      /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:deploy|release)(?::production)?\b/i.test(value)) {
    return "Los agentes no pueden ejecutar deploys; Preview pertenece a CI.";
  }
  if (/store-os-f7cf8|store-os-alpha\.vercel\.app|--environment[=\s]+production|--env[=\s]+prod\b|--apply\b/i.test(value)) {
    return "Operación contra producción bloqueada; requiere aprobaciones humanas separadas.";
  }
  const firebaseAllowed = /^\s*firebase\s+(?:--[^\s]+(?:=|\s+)\S+\s+)*emulators(?::|\s+)start\b[^;&|'"`]*$/i.test(value);
  if (/\bfirebase\b/i.test(value) && !firebaseAllowed) {
    return "Sólo se permite iniciar Firebase Emulator directamente; usa los scripts npm verificados para emulators:exec.";
  }
  if (/\b(?:gcloud|gsutil)\b/i.test(value)) return "Google Cloud remoto está bloqueado para agentes.";
  return "";
}

function needsPublishGate(input, command) {
  if (gitCommand(command, "push") || /\bgh\s+pr\s+create\b/i.test(command)) return true;
  const name = String(input.tool_name || "").toLowerCase();
  return /(?:create|open).*(?:pull_request|pr)|(?:pull_request|pr).*create|github_update_ref/.test(name);
}

function prBody(input, command, root) {
  for (const key of ["body", "bodyText", "body_text", "description"]) {
    if (typeof input.tool_input?.[key] === "string") return input.tool_input[key];
  }
  const fileMatch = command.match(/(?:^|\s)--body-file(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  if (fileMatch) {
    const file = path.resolve(root, fileMatch[1] || fileMatch[2] || fileMatch[3]);
    try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
  }
  const bodyMatch = command.match(/(?:^|\s)--body(?:=|\s+)(?:"([^"]*)"|'([^']*)')/i);
  return bodyMatch ? (bodyMatch[1] ?? bodyMatch[2] ?? "") : "";
}

function missingManifest(body, manifest) {
  const required = manifest.kind === "spec"
    ? [`Delivery-ID: ${manifest.id}`, "Delivery-Status: Pending approval"]
    : [`Delivery-ID: ${manifest.id}`, manifest.specPath, manifest.sha, ...(manifest.commands || [])];
  if (manifest.kind === "bootstrap") required.push(`Bootstrap-Base: ${manifest.baseSha}`);
  return required
    .filter((value) => !body.includes(value));
}

function option(command, name) {
  const match = command.match(new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|([^\\s]+))`, "i"));
  return match ? (match[1] || match[2] || match[3]) : "";
}

function handle(input) {
  const event = input.hook_event_name || input.hookEventName;
  const root = rootFrom(input);
  if (event === "SubagentStop") {
    const isReviewer = /reviewer/i.test(String(input.agent_type || input.agentType || input.subagent_type || ""));
    const isExplorer = /explorer/i.test(String(input.agent_type || input.agentType || input.subagent_type || ""));
    const value = parseContract(input.last_assistant_message, isReviewer);
    const identity = isReviewer ? value?.reviewer : value?.worker;
    if (!value || ((isReviewer || isExplorer) &&
        (!input.agent_id || identity?.id !== input.agent_id || identity?.profile !== input.agent_type))) {
      return `El subagente debe terminar con un único objeto JSON que incluya status, summary, evidence[] no vacío y findings[]. Usa id=${input.agent_id || "desconocido"} y profile=${input.agent_type || "desconocido"}.`;
    }
    if ((isReviewer || isExplorer) && !persistReceipt(root, input, value)) return "No se pudo persistir el recibo verificable del subagente.";
    return "";
  }
  if (event === "Stop") {
    const result = runGate(root, "stop");
    return result.status === 0 ? "" : (result.stderr || result.stdout || "Falta un gate terminal de Store OS.").trim();
  }
  if (event !== "PreToolUse") return "";

  const command = input.tool_input?.command || input.tool_input?.cmd || JSON.stringify(input.tool_input || {});
  const forbidden = forbiddenCommand(command, root);
  if (forbidden) return forbidden;
  const toolName = String(input.tool_name || "").toLowerCase();
  const serializedInput = JSON.stringify(input.tool_input || {});
  if (/(?:rerun|dispatch|cancel|delete|enable|disable).*(?:workflow|action|run)|(?:workflow|action|run).*(?:rerun|dispatch|cancel|delete|enable|disable)/.test(toolName)) {
    return "Los agentes no pueden mutar ejecuciones de GitHub Actions.";
  }
  const evidencePath = /\.delivery[\\/]runs(?:[\\/]|$)/i;
  const editsFiles = /apply_patch|\bedit\b|\bwrite\b|notebook/i.test(toolName);
  const mutatesFromShell = /(?:^|[;&|]\s*|\s)(?:rm|mv|cp|mkdir|touch|tee|truncate|install|node|python\d*|ruby|perl|sed|jq)\b|(?:^|[^<])>{1,2}(?!>)/i.test(command);
  if ((editsFiles && evidencePath.test(serializedInput)) || (evidencePath.test(command) && mutatesFromShell) ||
      (/delivery-hook\.cjs/i.test(command) && event === "PreToolUse")) {
    return "La evidencia de .delivery/runs sólo puede escribirla el hook o el CLI canónico.";
  }
  const directGithubMutation = toolName.includes("github") && (
    /(?:create|update|delete)_file$/.test(toolName) || /push_files$/.test(toolName) || /(?:create|update|delete).*commit/.test(toolName)
  );
  if (directGithubMutation) {
    return "Los conectores no pueden escribir archivos o commits directamente; usa una rama local y un draft PR con gate.";
  }
  if (/github_(?:update|delete)_ref/.test(toolName) && /(?:refs\/heads\/|["':/])main(?:["'}]|$)/i.test(serializedInput)) {
    return "Nunca se permite modificar la ref main desde un conector.";
  }
  if (/github_.*review.*(?:pull|pr)|github_.*(?:pull|pr).*review/.test(toolName)) {
    return "Los agentes no pueden aprobar ni publicar reviews de PR como autoridad humana.";
  }
  if (((toolName.includes("merge") || toolName.includes("approve") || toolName.includes("ready")) && toolName.includes("pull")) ||
      ((toolName.includes("deploy") || toolName.includes("production")) && toolName.startsWith("mcp__"))) {
    return "Merge y operaciones productivas están bloqueados para agentes.";
  }
  if (toolName.includes("pull") && (input.tool_input?.draft === false || input.tool_input?.isDraft === false || input.tool_input?.is_draft === false)) {
    return "Los agentes no pueden marcar un PR como ready.";
  }
  if (/\bgh\s+pr\s+create\b/i.test(command) && !/(?:^|\s)--draft(?:\s|$)/i.test(command)) {
    return "Los PR creados por agentes deben usar --draft.";
  }
  if (/(?:create|open).*(?:pull_request|pr)|(?:pull_request|pr).*create/.test(toolName) &&
      input.tool_input?.draft !== true && input.tool_input?.isDraft !== true && input.tool_input?.is_draft !== true) {
    return "Los PR creados por agentes deben permanecer draft.";
  }
  if (needsPublishGate(input, command)) {
    const result = runGate(root, "publish");
    if (result.status !== 0) return (result.stderr || result.stdout || "Falta gate publish.").trim();
    const createsPr = /\bgh\s+pr\s+create\b/i.test(command) ||
      /(?:create|open).*(?:pull_request|pr)|(?:pull_request|pr).*create/.test(toolName);
    if (createsPr) {
      let manifest;
      try { manifest = JSON.parse(result.stdout); } catch { return "El gate publish no devolvió un manifiesto válido."; }
      const base = option(command, "base") || input.tool_input?.base || input.tool_input?.baseRefName || input.tool_input?.base_ref_name;
      const head = option(command, "head") || input.tool_input?.head || input.tool_input?.headRefName || input.tool_input?.head_ref_name;
      if (base !== "main") return "Los draft PR de entrega deben declarar --base main.";
      if (head !== manifest.branch) return `La rama head del PR debe ser ${manifest.branch}.`;
      const missing = missingManifest(prBody(input, command, root), manifest);
      if (missing.length) return `El cuerpo del PR debe incluir Delivery-ID, spec, SHA y comandos finales. Faltan: ${missing.join(", ")}`;
    }
  }
  return "";
}

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, "utf8")); } catch { return {}; }
}

module.exports = { forbiddenCommand, gitCommand, handle, missingManifest, needsPublishGate, option, parseContract, prBody };

if (require.main === module) {
  const reason = handle(readInput());
  if (reason) block(reason);
  else process.stdout.write("{}\n");
}
