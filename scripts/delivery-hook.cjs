#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const CANONICAL_REPOSITORY = "imalvaroglez/store-os";

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
  if (!invokes(command, "git")) return false;
  const git = String.raw`(?:^|[;&|]\s*|\s)(?:\/[^\s;&|]+\/)?git\b[^\n;&|]*`;
  const literal = new RegExp(`${git}(?:^|\\s)${subcommand}(?:\\s|$)`, "i");
  const alias = new RegExp(`${git}alias\\.[^=\\s]+=${subcommand}\\b`, "i");
  return literal.test(command) || alias.test(command);
}

function normalizeGhCommand(command) {
  return command.replace(/(?:^|\s)(?:--repo(?:=\S+|\s+\S+)|-R(?:=?\S+|\s+\S+))(?=\s|$)/gi, " ");
}

function shellCommands(command) {
  const commands = [[]];
  let token = "";
  let quote = "";
  let escaped = false;
  const pushToken = () => {
    if (token) commands.at(-1).push(token);
    token = "";
  };
  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? "" : character;
    } else if (!quote && /[;&|]/.test(character)) {
      pushToken();
      if (commands.at(-1).length) commands.push([]);
    } else if (!quote && /\s/.test(character)) {
      pushToken();
    } else {
      token += character;
    }
  }
  pushToken();
  return commands.filter((words) => words.length);
}

function invokes(command, executable) {
  return shellCommands(command).some((words) => {
    let index = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) index += 1;
    if (words[index] === "env") {
      index += 1;
      while (/^-/.test(words[index] || "") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) {
        if (["-u", "--unset"].includes(words[index])) index += 1;
        index += 1;
      }
    }
    if (["command", "sudo"].includes(words[index])) index += 1;
    if (words[index] === "npx") index += 1;
    else if (["npm", "pnpm", "yarn"].includes(words[index]) && words[index + 1] === "exec") {
      index += 2;
      if (words[index] === "--") index += 1;
    }
    return path.basename(words[index] || "") === executable;
  });
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
  const gh = normalizeGhCommand(value);
  const invokesGh = invokes(gh, "gh");
  if (/GH_(?:REPO|HOST)\s*=/i.test(value)) return "GH_REPO y GH_HOST no pueden redirigir el repositorio canónico.";
  if (/[<>]/.test(value) || /(?:^|[;&|]\s*|\s)(?:rm|mv|cp|dd|install|mkdir|touch|tee|truncate|printf|echo)\b/i.test(value) ||
      /\b(?:node|python\d*|ruby|perl|bash|zsh|sh)\s+(?:-[ec]|-)\b/i.test(value)) {
    return "Bash no puede escribir archivos ni ejecutar código dinámico; usa apply_patch o el CLI canónico.";
  }
  if (/\bgit\b[^\n;&|]*(?:-c\s+alias\.|--config-env(?:=|\s+)alias\.)/i.test(value)) return "Los aliases Git están bloqueados por política de entrega.";
  if (/\bgit\b[^\n;&|]*\bsend-pack\b/i.test(value) ||
      /\bgit(?:\s+(?:-C|-c|--git-dir|--work-tree)\s+\S+|\s+--[^\s]+)*\s+(?:["']?\$|`)/i.test(value)) {
    return "Los comandos Git dinámicos o send-pack eluden los gates y están bloqueados.";
  }
  if (invokesGh && /\bgh\s+api\b/i.test(gh)) return "gh api está bloqueado; usa los comandos PR cubiertos por el harness.";
  if (invokesGh && (/\bgh\b[^\n;&|]*\brun\b[^\n;&|]*\b(?:rerun|cancel|delete)\b/i.test(gh) ||
      /\bgh\b[^\n;&|]*\bworkflow\b[^\n;&|]*\b(?:run|enable|disable)\b/i.test(gh))) {
    return "Los agentes no pueden iniciar, relanzar, cancelar ni borrar ejecuciones de GitHub Actions.";
  }
  if (invokesGh && /\bgh\s+repo\s+sync\b/i.test(gh)) return "gh repo sync puede mover refs sin gate y está bloqueado.";
  if (invokesGh && /\bgh\s+pr\s+edit\b/i.test(gh)) return "El manifiesto de un PR de entrega no puede editarse después de crearlo.";
  if (invokesGh && /\bgh\s+pr\s+review\b/i.test(gh)) return "Los agentes no pueden aprobar ni revisar PRs como autoridad humana.";
  if (/\bgit\b[^\n;&|]*\bremote\s+(?:add|remove|rename|set-head|set-branches|set-url|update|prune)\b/i.test(value) ||
      /\bgit\b[^\n;&|]*\bconfig\b[^\n;&|]*(?:remote\.|url\.)/i.test(value)) {
    return "La identidad de origin no puede modificarse durante una entrega.";
  }
  if (gitCommand(value, "merge") || (invokesGh && /\bgh\s+pr\s+(merge|ready)\b/i.test(gh))) {
    return "Merge y marcar el PR ready requieren acción humana.";
  }
  const pushes = gitCommand(value, "push");
  const targetsMain = /(?:^|\s)\+?(?:\S*:)?(?:refs\/heads\/)?main(?:\s|$)/i.test(value);
  if ((pushes && (targetsMain || /(?:^|\s)--(?:mirror|all)(?:\s|$)/i.test(value))) ||
      (pushes && gitBranch(root) === "main")) {
    return "Nunca se permite push directo a main.";
  }
  if (invokes(value, "vercel") ||
      (invokes(value, "firebase") && /\bfirebase\s+[^\n;&|]*\bdeploy\b/i.test(value)) ||
      (["npm", "pnpm", "yarn"].some((name) => invokes(value, name)) &&
        /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:deploy|release)(?::production)?\b/i.test(value))) {
    return "Los agentes no pueden ejecutar deploys; Preview pertenece a CI.";
  }
  const invokesRemoteTool = ["node", "npm", "pnpm", "yarn", "firebase", "gcloud", "gsutil", "vercel"].some((name) => invokes(value, name));
  if (invokesRemoteTool && /store-os-f7cf8|store-os-alpha\.vercel\.app|--environment[=\s]+production|--env[=\s]+prod\b|--apply\b/i.test(value)) {
    return "Operación contra producción bloqueada; requiere aprobaciones humanas separadas.";
  }
  const firebaseAllowed = /^\s*firebase\s+(?:--[^\s]+(?:=|\s+)\S+\s+)*emulators(?::|\s+)start\b[^;&|'"`]*$/i.test(value);
  if (invokes(value, "firebase") && !firebaseAllowed) {
    return "Sólo se permite iniciar Firebase Emulator directamente; usa los scripts npm verificados para emulators:exec.";
  }
  if (invokes(value, "gcloud") || invokes(value, "gsutil")) return "Google Cloud remoto está bloqueado para agentes.";
  return "";
}

function needsPublishGate(input, command) {
  const normalized = normalizeGhCommand(command);
  if (gitCommand(command, "push") || (invokes(normalized, "gh") && /\bgh\s+pr\s+(?:create|new)\b/i.test(normalized))) return true;
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

function validPush(command, manifest) {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expected = new RegExp(`^\\s*(?:/usr/bin/)?git\\s+push\\s+(?:-u\\s+|--set-upstream\\s+)?origin\\s+${escape(manifest.sha)}:refs/heads/${escape(manifest.branch)}\\s*$`);
  return expected.test(command);
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
  const normalizedCommand = normalizeGhCommand(command);
  const forbidden = forbiddenCommand(command, root);
  if (forbidden) return forbidden;
  const toolName = String(input.tool_name || "").toLowerCase();
  const serializedInput = JSON.stringify(input.tool_input || {});
  if (/(?:rerun|dispatch|cancel|delete|enable|disable).*(?:workflow|action|run)|(?:workflow|action|run).*(?:rerun|dispatch|cancel|delete|enable|disable)/.test(toolName)) {
    return "Los agentes no pueden mutar ejecuciones de GitHub Actions.";
  }
  const evidencePath = /\.delivery[\\/]runs(?:[\\/]|$)/i;
  const editsFiles = /apply_patch|\bedit\b|\bwrite\b|notebook/i.test(toolName);
  const mutatesEvidence = editsFiles || /(?:^|[;&|]\s*|\s)(?:node|python\d*|ruby|perl|bash|zsh|sh|chmod|chown)\b/i.test(command) ||
    /\bgit\b[^\n;&|]*\badd\b/i.test(command) || /(?:^|\s)-delete(?:\s|$)/i.test(command);
  const executesHook = /(?:^|[;&|]\s*)(?:(?:\/[^\s;&|]+\/)?node\s+)?(?:\.\/)?scripts\/delivery-hook\.cjs(?:\s|$)/i.test(command);
  if ((evidencePath.test(serializedInput) && mutatesEvidence) || executesHook) {
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
  if (/(?:update|edit).*(?:pull_request|pr)|(?:pull_request|pr).*(?:update|edit)/.test(toolName)) {
    return "El manifiesto de un PR de entrega no puede editarse después de crearlo.";
  }
  if (((toolName.includes("merge") || toolName.includes("approve") || toolName.includes("ready")) && toolName.includes("pull")) ||
      ((toolName.includes("deploy") || toolName.includes("production")) && toolName.startsWith("mcp__"))) {
    return "Merge y operaciones productivas están bloqueados para agentes.";
  }
  if (toolName.includes("pull") && (input.tool_input?.draft === false || input.tool_input?.isDraft === false || input.tool_input?.is_draft === false)) {
    return "Los agentes no pueden marcar un PR como ready.";
  }
  if (invokes(normalizedCommand, "gh") && /\bgh\s+pr\s+(?:create|new)\b/i.test(normalizedCommand) && !/(?:^|\s)--draft(?:\s|$)/i.test(command)) {
    return "Los PR creados por agentes deben usar --draft.";
  }
  if (/(?:create|open).*(?:pull_request|pr)|(?:pull_request|pr).*create/.test(toolName) &&
      input.tool_input?.draft !== true && input.tool_input?.isDraft !== true && input.tool_input?.is_draft !== true) {
    return "Los PR creados por agentes deben permanecer draft.";
  }
  if (needsPublishGate(input, command)) {
    const result = runGate(root, "publish");
    if (result.status !== 0) return (result.stderr || result.stdout || "Falta gate publish.").trim();
    let manifest;
    try { manifest = JSON.parse(result.stdout); } catch { return "El gate publish no devolvió un manifiesto válido."; }
    if (gitCommand(command, "push") && !validPush(command, manifest)) {
      return `El push debe fijar exactamente ${manifest.sha}:refs/heads/${manifest.branch} hacia origin.`;
    }
    if (/github_update_ref/.test(toolName)) {
      const ref = input.tool_input?.ref || input.tool_input?.branch || input.tool_input?.branch_name;
      if (![manifest.branch, `refs/heads/${manifest.branch}`].includes(ref) || input.tool_input?.sha !== manifest.sha) {
        return "La actualización de ref debe coincidir exactamente con rama y SHA del gate publish.";
      }
    }
    const createsPr = (invokes(normalizedCommand, "gh") && /\bgh\s+pr\s+(?:create|new)\b/i.test(normalizedCommand)) ||
      /(?:create|open).*(?:pull_request|pr)|(?:pull_request|pr).*create/.test(toolName);
    if (createsPr) {
      const repository = option(command, "repo") || command.match(/(?:^|\s)-R(?:=|\s+)?(\S+)/)?.[1] ||
        input.tool_input?.repo || input.tool_input?.repository || input.tool_input?.nameWithOwner;
      if (repository && repository !== CANONICAL_REPOSITORY) return `El PR debe crearse en ${CANONICAL_REPOSITORY}.`;
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

module.exports = { forbiddenCommand, gitCommand, handle, missingManifest, needsPublishGate, option, parseContract, prBody, validPush };

if (require.main === module) {
  const reason = handle(readInput());
  if (reason) block(reason);
  else process.stdout.write("{}\n");
}
