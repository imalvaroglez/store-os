#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const VALID_STATUSES = new Set(["needs-spec", "awaiting-approval", "queued", "frozen"]);
const REVIEW_STAGES = ["review-standards", "review-security", "review-qa"];
const REVIEW_LENSES = {
  "review-standards": "standards-spec",
  "review-security": "security-privacy",
  "review-qa": "qa-evidence",
};
const RECORD_STAGES = new Set(["discovery", "test-design", "plan", ...REVIEW_STAGES, "verifier"]);
const TERMINAL_STATES = new Set(["WAITING_SPEC_APPROVAL", "BLOCKED_HUMAN", "REMOTE_GREEN"]);
const ROOT = path.resolve(path.join(__dirname, ".."));
const CANONICAL_ORIGIN = "https://github.com/imalvaroglez/store-os.git";
const CANONICAL_REPOSITORY = "github.com/imalvaroglez/store-os";
const BOOTSTRAP = Object.freeze({
  id: "delivery-harness-bootstrap",
  branch: "codex/autonomous-delivery-harness",
  baseSha: "cbd24ae9e6870a7783b30eeb901930d8f1f5bfc3",
  specPath: "docs/adr/0001-multi-agent-delivery-harness.md",
  approvedBy: "Álvaro González",
  previewChecks: [{ path: "/", selector: "body", text: "Entrar" }],
});
const BOOTSTRAP_ALLOWED_PATHS = Object.freeze([
  ".agents/skills/store-os-delivery/SKILL.md",
  ".agents/skills/store-os-delivery/agents/openai.yaml",
  ".claude/agents/architecture-planner.md",
  ".claude/agents/architecture-reviewer.md",
  ".claude/agents/code-cleaner.md",
  ".claude/agents/code-reviewer.md",
  ".claude/agents/evidence-verifier.md",
  ".claude/agents/gherkin-author.md",
  ".claude/agents/implementer.md",
  ".claude/agents/qa-designer.md",
  ".claude/agents/qa-executor.md",
  ".claude/agents/requirements-analyst.md",
  ".claude/agents/security-hardener.md",
  ".claude/agents/senior-implementer.md",
  ".claude/agents/store-os-explorer.md",
  ".claude/agents/store-os-reviewer.md",
  ".claude/agents/story-reviewer.md",
  ".claude/agents/workflow-simulator.md",
  ".claude/loops/software-delivery.fsm.yaml",
  ".claude/schemas/agent-result.schema.json",
  ".claude/schemas/fsm.schema.json",
  ".claude/schemas/run-event.schema.json",
  ".claude/settings.json",
  ".claude/skills/store-os-delivery/SKILL.md",
  ".claude/skills/store-os-delivery/agents/openai.yaml",
  ".claude/workflows/simulate-software-delivery.js",
  ".claude/workflows/software-delivery.fsm.json",
  ".claude/workflows/software-delivery.js",
  ".codex/agents/store-os-explorer.toml",
  ".codex/agents/store-os-reviewer.toml",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".delivery/bootstrap.json",
  ".delivery/queue.json",
  ".github/workflows/ci.yml",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "LOOPS.md",
  "docs/BACKLOG.md",
  "docs/LOOPS.md",
  "docs/adr/0001-multi-agent-delivery-harness.md",
  "docs/superpowers/specs/2026-08-06-privacidad-arco-v1-design.md",
  "e2e/firebase.spec.ts",
  "e2e/helpers.ts",
  "e2e/public-catalog.spec.ts",
  "e2e/responsive.spec.ts",
  "e2e/smoke.spec.ts",
  "package.json",
  "playwright.firebase.config.ts",
  "scripts/delivery-harness.cjs",
  "scripts/delivery-hook.cjs",
  "src/delivery/delivery-harness.test.ts",
  "src/delivery/delivery-hook.test.ts",
  "src/loops/engine.cjs",
  "src/loops/engine.test.ts",
  "src/loops/software-delivery.test.ts",
]);

class DeliveryError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "DeliveryError";
    this.details = details;
  }
}

function fail(message, details) {
  throw new DeliveryError(message, details);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`No se pudo leer JSON: ${file}`, [error.message]);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeFile(root, candidate) {
  if (typeof candidate !== "string" || candidate.length === 0 || path.isAbsolute(candidate)) {
    fail("La ruta debe ser relativa al repositorio", [String(candidate)]);
  }
  const normalized = path.posix.normalize(candidate.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) fail("La ruta sale del repositorio", [candidate]);
  return normalized;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: options.replaceEnv ? options.env : { ...process.env, ...options.env },
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(" "),
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function npmInvocation(args) {
  const executable = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
  if (!fs.existsSync(executable)) fail("No se encontró npm junto al ejecutable de Node", [executable]);
  if (process.platform === "win32") return { command: executable, args };
  return { command: process.execPath, args: [fs.realpathSync(executable), ...args] };
}

function ghInvocation(root, args) {
  const realRoot = fs.realpathSync(root);
  const fixtureRoot = /^store-os-(?:bootstrap|delivery)-[A-Za-z0-9]+$/.test(path.basename(realRoot));
  const fixtureGh = fixtureRoot && process.env.TEST_GH_BIN && fs.existsSync(process.env.TEST_GH_BIN) &&
    fs.realpathSync(process.env.TEST_GH_BIN).startsWith(`${realRoot}${path.sep}`) ? process.env.TEST_GH_BIN : "";
  const candidates = [
    ...(fixtureGh ? [fixtureGh] : []),
    ...(process.platform === "win32" ? [] : ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]),
  ];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) fail("No se encontró gh en una ruta global confiable");
  return { command: executable, args: ["--repo", CANONICAL_REPOSITORY, ...args] };
}

function verificationPath() {
  return [...new Set([path.dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"])].join(path.delimiter);
}

function verificationEnvironment() {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^npm_config_/i.test(name) && !new Set(["NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "SHELLOPTS"]).has(name)));
  return {
    ...inherited,
    PATH: verificationPath(),
    npm_config_script_shell: "/bin/sh",
    npm_config_userconfig: "/dev/null",
  };
}

function git(root, args, allowFailure = false) {
  const result = run("/usr/bin/git", ["-C", root, ...args], { cwd: root });
  if (!allowFailure && result.exitCode !== 0) fail(`Falló git ${args.join(" ")}`, [result.stderr.trim()]);
  return result;
}

function repositoryIdentityBlockers(root = ROOT) {
  const configured = git(root, ["config", "--get", "remote.origin.url"], true).stdout.trim();
  return configured === CANONICAL_ORIGIN ? [] : [`origin debe ser ${CANONICAL_ORIGIN}`];
}

function currentSha(root = ROOT) {
  return git(root, ["rev-parse", "HEAD"]).stdout.trim();
}

function currentBranch(root = ROOT) {
  return git(root, ["branch", "--show-current"]).stdout.trim();
}

function mainRef(root = ROOT) {
  return git(root, ["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"], true).exitCode === 0
    ? "origin/main"
    : "main";
}

function syncMain(root = ROOT) {
  const identity = repositoryIdentityBlockers(root);
  if (identity.length) fail("Repositorio remoto no autorizado", identity);
  const result = git(root, ["fetch", "origin", "main", "--quiet"], true);
  if (result.exitCode !== 0) fail("No se pudo actualizar origin/main; el harness falla cerrado", [result.stderr.trim()]);
  return "origin/main";
}

function isTreeClean(root = ROOT) {
  return git(root, ["status", "--porcelain"]).stdout.trim() === "";
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function specMetadata(text) {
  const get = (name) => text.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m"))?.[1]?.trim() || "";
  return { id: get("Delivery-ID"), status: get("Delivery-Status"), approvedBy: get("Approved-By") };
}

function validateSpec(item, text, expectedStatus) {
  const metadata = specMetadata(text);
  const errors = [];
  if (metadata.id !== item.id) errors.push(`Delivery-ID debe ser ${item.id}`);
  if (metadata.status !== expectedStatus) errors.push(`Delivery-Status debe ser ${expectedStatus}`);
  if (expectedStatus === "Approved" && !metadata.approvedBy) errors.push("Falta Approved-By");
  if (errors.length) fail(`Spec incongruente para ${item.id}`, errors);
  return metadata;
}

function loadQueue(root = ROOT) {
  const queue = readJson(path.join(root, ".delivery", "queue.json"));
  if (queue?.version !== 1 || !Array.isArray(queue.items)) fail(".delivery/queue.json debe usar version 1 e items[]");
  return queue;
}

function loadQueueFromRef(root, ref = mainRef(root)) {
  const result = git(root, ["show", `${ref}:.delivery/queue.json`], true);
  if (result.exitCode !== 0) fail(`No se pudo leer .delivery/queue.json desde ${ref}`, [result.stderr.trim()]);
  try {
    const queue = JSON.parse(result.stdout);
    if (queue?.version !== 1 || !Array.isArray(queue.items)) fail(`La cola de ${ref} es inválida`);
    return queue;
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    fail(`La cola de ${ref} no es JSON válido`, [error.message]);
  }
}

function refHasPath(root, ref, file) {
  return git(root, ["cat-file", "-e", `${ref}:${file}`], true).exitCode === 0;
}

function loadBootstrapManifest(root = ROOT) {
  const file = path.join(root, ".delivery", "bootstrap.json");
  const manifest = readJson(file);
  const expectedKeys = ["approvedBy", "baseSha", "branch", "id", "previewChecks", "specPath", "version"];
  const errors = [];
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedKeys)) errors.push("bootstrap.json contiene claves faltantes o no permitidas");
  for (const key of ["id", "branch", "baseSha", "specPath", "approvedBy"]) {
    if (manifest[key] !== BOOTSTRAP[key]) errors.push(`${key} no coincide con el bootstrap aprobado`);
  }
  if (manifest.version !== 1) errors.push("bootstrap.json debe usar version 1");
  if (JSON.stringify(manifest.previewChecks) !== JSON.stringify(BOOTSTRAP.previewChecks)) errors.push("previewChecks no coincide con el bootstrap aprobado");
  if (!fs.existsSync(path.join(root, BOOTSTRAP.specPath))) errors.push(`Falta ${BOOTSTRAP.specPath}`);
  if (errors.length) fail("Manifiesto bootstrap inválido", errors);
  return manifest;
}

function bootstrapDeclared(root = ROOT) {
  return currentBranch(root) === BOOTSTRAP.branch && fs.existsSync(path.join(root, ".delivery", "bootstrap.json"));
}

function bootstrapStateFile(root = ROOT, name = "verification") {
  return path.join(root, ".delivery", "runs", "bootstrap", `${name}.json`);
}

function bootstrapIdentityBlockers(root = ROOT) {
  const blockers = repositoryIdentityBlockers(root);
  let manifest;
  try { manifest = loadBootstrapManifest(root); } catch (error) {
    return [error.message, ...(error.details || [])];
  }
  const ref = mainRef(root);
  if (ref !== "origin/main") blockers.push("Bootstrap requiere origin/main verificable");
  const baseSha = git(root, ["rev-parse", ref], true).stdout.trim();
  if (baseSha !== manifest.baseSha) blockers.push(`Bootstrap expiró: origin/main=${baseSha || "ilegible"}`);
  if (refHasPath(root, ref, ".delivery/queue.json") || refHasPath(root, ref, "scripts/delivery-harness.cjs")) {
    blockers.push("Bootstrap ya fue instalado en main");
  }
  if (currentBranch(root) !== manifest.branch) blockers.push(`Bootstrap sólo permite la rama ${manifest.branch}`);
  if (!isTreeClean(root)) blockers.push("El árbol Git no está limpio");
  const sha = currentSha(root);
  if (sha === manifest.baseSha) blockers.push("Falta un commit candidato bootstrap");
  const mergeBase = git(root, ["merge-base", sha, ref], true).stdout.trim();
  if (mergeBase !== manifest.baseSha) blockers.push("El candidato no desciende directamente de la base bootstrap aprobada");
  const mergeCommits = git(root, ["rev-list", "--merges", `${manifest.baseSha}..${sha}`], true).stdout.trim();
  if (mergeCommits) blockers.push("El bootstrap debe ser una historia lineal sin commits de merge");
  const actualPaths = changedFiles(root, manifest.baseSha).sort();
  const expectedPaths = [...BOOTSTRAP_ALLOWED_PATHS].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    const missing = expectedPaths.filter((file) => !actualPaths.includes(file));
    const unexpected = actualPaths.filter((file) => !expectedPaths.includes(file));
    if (missing.length) blockers.push(`Archivos bootstrap faltantes: ${missing.join(", ")}`);
    if (unexpected.length) blockers.push(`Archivos fuera del bootstrap aprobado: ${unexpected.join(", ")}`);
  }
  if (loadActiveRun(root, false)) blockers.push("Bootstrap no puede reutilizar una corrida de producto");
  return blockers;
}

function validateQueue(root = ROOT) {
  const queue = loadQueue(root);
  const ids = new Set();
  const priorities = new Set();
  const specPaths = new Set();
  const errors = [];

  for (const item of queue.items) {
    if (!item || typeof item !== "object") {
      errors.push("Cada item debe ser un objeto");
      continue;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id || "")) errors.push(`ID inválido: ${item.id}`);
    if (ids.has(item.id)) errors.push(`ID duplicado: ${item.id}`);
    ids.add(item.id);
    if (!Number.isInteger(item.priority) || item.priority <= 0) errors.push(`Prioridad inválida: ${item.id}`);
    if (priorities.has(item.priority)) errors.push(`Prioridad duplicada: ${item.priority}`);
    priorities.add(item.priority);
    if (!VALID_STATUSES.has(item.status)) errors.push(`Status inválido: ${item.id}`);
    if (typeof item.title !== "string" || !item.title.trim()) errors.push(`Title faltante: ${item.id}`);
    try {
      const specPath = relativeFile(root, item.specPath);
      if (specPaths.has(specPath)) errors.push(`specPath duplicado: ${specPath}`);
      specPaths.add(specPath);
    } catch (error) { errors.push(`${item.id}: ${error.message}`); }
    if (!Array.isArray(item.dependsOn)) errors.push(`dependsOn debe ser array: ${item.id}`);
    if (!Array.isArray(item.previewChecks)) errors.push(`previewChecks debe ser array: ${item.id}`);
    if (item.status === "queued" && item.previewChecks?.length === 0) errors.push(`queued requiere al menos un previewCheck: ${item.id}`);
    for (const check of item.previewChecks || []) {
      if (!check || typeof check.path !== "string" || !/^\/(?!\/)/.test(check.path) ||
          typeof check.selector !== "string" || !check.selector || typeof check.text !== "string") {
        errors.push(`previewCheck inválido: ${item.id}`);
      }
    }
  }

  for (const item of queue.items) {
    for (const dependency of item.dependsOn || []) {
      if (!ids.has(dependency)) errors.push(`Dependencia desconocida ${dependency}: ${item.id}`);
      if (dependency === item.id) errors.push(`Dependencia circular directa: ${item.id}`);
    }
    const specFile = path.join(root, item.specPath || "");
    if (item.status === "queued" || item.status === "awaiting-approval") {
      if (!fs.existsSync(specFile)) {
        errors.push(`Spec faltante para ${item.status}: ${item.id}`);
      } else {
        try {
          // queued exige Approved+Approved-By; awaiting-approval acepta ambos
          // estados de header (la aprobación real es el merge del owner).
          const text = fs.readFileSync(specFile, "utf8");
          const status = item.status === "queued"
            ? "Approved"
            : (specMetadata(text).status === "Approved" ? "Approved" : "Pending approval");
          validateSpec(item, text, status);
        } catch (error) {
          errors.push(`${item.id}: ${error.message}${error.details?.length ? ` (${error.details.join(", ")})` : ""}`);
        }
      }
    }
  }

  const completedDirectory = path.join(root, ".delivery", "completed");
  if (fs.existsSync(completedDirectory)) {
    for (const name of fs.readdirSync(completedDirectory).filter((entry) => entry.endsWith(".json"))) {
      try {
        const value = readJson(path.join(completedDirectory, name));
        const id = name.slice(0, -5);
        const item = queue.items.find((entry) => entry.id === id);
        if (!item || value.id !== id || value.specPath !== item.specPath || value.deliveryStatus !== "implemented") {
          errors.push(`Marcador completed inválido: ${name}`);
        }
      } catch (error) {
        errors.push(`Marcador completed inválido: ${name} (${error.message})`);
      }
    }
  }

  const sorted = [...queue.items].sort((a, b) => a.priority - b.priority);
  if (sorted.some((item, index) => item.id !== queue.items[index]?.id)) errors.push("La cola no está ordenada por prioridad");
  if (errors.length) fail("Configuración de cola inválida", errors);
  return queue;
}

function completedIds(root = ROOT, ref = mainRef(root)) {
  const result = git(root, ["ls-tree", "-r", "--name-only", ref, "--", ".delivery/completed"], true);
  if (result.exitCode !== 0) fail(`No se pudieron leer entregas completadas desde ${ref}`, [result.stderr.trim()]);
  return new Set(result.stdout.split("\n")
    .filter((name) => /^\.delivery\/completed\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(name))
    .map((name) => path.basename(name, ".json")));
}

function openPullRequests(root = ROOT) {
  const command = ghInvocation(root, ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,body,headRefName,url,files,isDraft"]);
  const result = run(command.command, command.args, { cwd: root });
  if (result.exitCode !== 0) fail("No se pudieron consultar los PR abiertos; el harness falla cerrado", [result.stderr.trim()]);
  try { return JSON.parse(result.stdout); } catch { fail("gh devolvió PRs inválidos"); }
}

function closedPullRequests(root = ROOT) {
  const command = ghInvocation(root, ["pr", "list", "--state", "closed", "--limit", "100", "--json", "number,body,url,mergedAt"]);
  const result = run(command.command, command.args, { cwd: root });
  if (result.exitCode !== 0) fail("No se pudieron consultar los PR cerrados; el harness falla cerrado", [result.stderr.trim()]);
  try { return JSON.parse(result.stdout); } catch { fail("gh devolvió PRs cerrados inválidos"); }
}

function deliveryIdFromBody(body = "") {
  return String(body || "").match(/^Delivery-ID:\s*([a-z0-9-]+)\s*$/m)?.[1] || "";
}

// El owner se deriva del repositorio canónico (constante verificada contra
// origin en repositoryIdentityBlockers). No usamos `gh repo view` porque no
// acepta el flag --repo que ghInvocation antepone a todo comando gh.
function repoOwnerLogin() {
  return CANONICAL_REPOSITORY.split("/")[1] ?? null; // "imalvaroglez"
}

const ownerMergedSpecCache = new Map();
function specApprovedByOwnerMerge(root = ROOT, specPath) {
  if (ownerMergedSpecCache.has(specPath)) return ownerMergedSpecCache.get(specPath);
  let approved = false;
  const owner = repoOwnerLogin(root);
  if (owner) {
    const command = ghInvocation(root, ["pr", "list", "--state", "merged", "--limit", "100", "--json", "number,mergedBy,files"]);
    const result = run(command.command, command.args, { cwd: root });
    if (result.exitCode === 0) {
      try {
        approved = JSON.parse(result.stdout).some((pr) =>
          pr.mergedBy?.login === owner && (pr.files || []).some((file) => file.path === specPath));
      } catch { approved = false; } // falla cerrado
    }
  }
  ownerMergedSpecCache.set(specPath, approved);
  return approved;
}

function ownerApproved(queueItem, root = ROOT) {
  return queueItem.status === "queued"
    || (queueItem.status === "awaiting-approval" && specApprovedByOwnerMerge(root, queueItem.specPath));
}

function queueOutcome(queue, done, prs, active = null) {
  for (const item of queue.items) {
    if (item.status === "frozen" || done.has(item.id)) continue;
    const existing = prs.find((pr) => deliveryIdFromBody(pr.body) === item.id);
    if (existing && active?.id === item.id && active.state === "REMOTE_GREEN") continue;
    if (existing) return { outcome: "WAITING_PR", item, pr: { number: existing.number, url: existing.url } };
    if (item.status === "needs-spec") {
      return {
        outcome: "DRAFT_SPEC",
        item,
        template: { "Delivery-ID": item.id, "Delivery-Status": "Pending approval" },
        message: "Crear únicamente una spec en draft PR y pausar hasta aprobación humana.",
      };
    }
    if (item.status === "awaiting-approval" && !specApprovedByOwnerMerge(ROOT, item.specPath)) {
      return { outcome: "WAITING_SPEC_APPROVAL", item, message: "La spec debe ser aprobada y fusionada por una persona." };
    }
    const missing = item.dependsOn.filter((id) => !done.has(id));
    if (missing.length) return { outcome: "BLOCKED_DEPENDENCY", item, dependsOn: missing };
    return { outcome: "READY", item };
  }
  return { outcome: "EMPTY" };
}

function nextDelivery(root = ROOT, prs = openPullRequests(root), closedPrs) {
  const queue = validateQueue(root);
  const done = completedIds(root);
  const active = loadActiveRun(root, false);
  if (active?.state === "BLOCKED_HUMAN") return { outcome: "BLOCKED_HUMAN", item: queue.items.find((item) => item.id === active.id), run: active.runId };
  // Run huérfano: la entrega ya fue mergeada a main sin pasar por
  // REMOTE_GREEN (decisión del owner, p.ej. preview tras SSO). El item está
  // en completed; el run activo no bloquea la cola.
  if (active && !TERMINAL_STATES.has(active.state) && !completedIds(root).has(active.id)) {
    const closed = closedPrs || closedPullRequests(root);
    const canRetry = closed.some((pr) => deliveryIdFromBody(pr.body) === active.id && !pr.mergedAt);
    if (!canRetry) fail(`La entrega ${active.id} sigue activa`, [active.state]);
    return { ...queueOutcome(queue, done, prs), retry: true };
  }
  return queueOutcome(queue, done, prs, active);
}

function runsDirectory(root = ROOT) {
  return path.join(root, ".delivery", "runs");
}

function activePointer(root = ROOT) {
  return path.join(runsDirectory(root), "active.json");
}

function loadActiveRun(root = ROOT, required = true) {
  const pointer = activePointer(root);
  if (!fs.existsSync(pointer)) {
    if (required) fail("No hay una entrega activa; ejecuta delivery begin <id>");
    return null;
  }
  const { runId } = readJson(pointer);
  const file = path.join(runsDirectory(root), runId, "run.json");
  if (!fs.existsSync(file)) fail("El puntero de corrida está roto", [runId]);
  return readJson(file);
}

function saveRun(root, run) {
  writeJson(path.join(runsDirectory(root), run.runId, "run.json"), run);
  writeJson(activePointer(root), { runId: run.runId });
}

function specFromMain(root, item) {
  const ref = mainRef(root);
  const result = git(root, ["show", `${ref}:${item.specPath}`], true);
  if (result.exitCode !== 0) fail(`La spec ${item.specPath} no existe en ${ref}`, ["Debe aprobarse y fusionarse antes de implementar."]);
  validateSpec(item, result.stdout, "Approved");
  return { ref, text: result.stdout };
}

function beginDelivery(root = ROOT, id, prs = openPullRequests(root), closedPrs) {
  const active = loadActiveRun(root, false);
  if (active?.state === "BLOCKED_HUMAN") fail(`La entrega ${active.id} está BLOCKED_HUMAN`, ["Sólo una persona puede retirar la evidencia bloqueada."]);
  let retryingClosed = false;
  // Igual que en nextDelivery: un run huérfano cuyo item ya está completado
  // en main no bloquea begin de la siguiente entrega.
  if (active && !TERMINAL_STATES.has(active.state) && !completedIds(root).has(active.id)) {
    const closed = closedPrs || closedPullRequests(root);
    retryingClosed = active.id === id && closed.some((pr) => deliveryIdFromBody(pr.body) === id && !pr.mergedAt);
    if (!retryingClosed) fail(`Ya existe una entrega activa: ${active.id}`);
  }
  const authorization = retryingClosed
    ? queueOutcome(validateQueue(root), completedIds(root), prs)
    : nextDelivery(root, prs);
  if (authorization.outcome !== "READY" || authorization.item?.id !== id) {
    fail(`${id} no es la siguiente entrega autorizada`, [authorization.outcome, authorization.item?.id || "sin item"]);
  }
  const queue = validateQueue(root);
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item) fail(`Delivery-ID desconocido: ${id}`);
  if (!ownerApproved(item)) fail(`${id} no está autorizado`, [item.status, "se requiere queued o awaiting-approval con spec mergeada por el owner"]);
  if (completedIds(root).has(id)) fail(`${id} ya fue fusionado`);
  if (prs.some((pr) => deliveryIdFromBody(pr.body) === id)) fail(`Ya existe un PR abierto para ${id}`);
  const missing = item.dependsOn.filter((dependency) => !completedIds(root).has(dependency));
  if (missing.length) fail(`${id} tiene dependencias abiertas`, missing);
  const branch = currentBranch(root);
  if (!branch || branch === "main") fail("begin debe ejecutarse en una rama de entrega creada desde main");
  if (!isTreeClean(root)) fail("El árbol debe estar limpio antes de begin");

  const { ref, text } = specFromMain(root, item);
  const baseSha = git(root, ["rev-parse", ref]).stdout.trim();
  const headSha = currentSha(root);
  if (baseSha !== headSha) fail("La rama debe comenzar exactamente en el main actualizado", [`main=${baseSha}`, `HEAD=${headSha}`]);
  const now = new Date().toISOString();
  const runId = `${id}-${Date.now()}`;
  const runState = {
    version: 1,
    runId,
    id,
    title: item.title,
    branch,
    specPath: item.specPath,
    specHash: hash(text),
    queueItemHash: hash(JSON.stringify(item)),
    baseSha,
    headSha,
    state: "ACTIVE",
    correctionRounds: 0,
    correctionHeads: [],
    artifacts: {},
    artifactHistory: {},
    verification: {},
    remote: null,
    transitions: [{ at: now, event: "BEGIN", from: null, to: "ACTIVE", sha: headSha }],
  };
  saveRun(root, runState);
  return runState;
}

function requireEvidence(result) {
  if (!Array.isArray(result.evidence) || result.evidence.length === 0 || result.evidence.some((entry) => typeof entry !== "string" || !entry.trim())) {
    fail("PASS autodeclarado rechazado: evidence[] no puede estar vacío");
  }
}

function validateRecord(stage, result) {
  if (!RECORD_STAGES.has(stage)) fail(`Stage no permitido: ${stage}`);
  if (!result || typeof result !== "object" || Array.isArray(result)) fail("El resultado debe ser un objeto JSON");
  if (!new Set(["PASS", "FAIL", "BLOCKED"]).has(result.status)) fail("status debe ser PASS, FAIL o BLOCKED");
  if (typeof result.summary !== "string" || !result.summary.trim()) fail("summary es obligatorio");
  if (result.status === "PASS") requireEvidence(result);
  if (["discovery", "test-design"].includes(stage)) {
    if (!Array.isArray(result.findings) || !result.worker || typeof result.worker.id !== "string" || !result.worker.id.trim() ||
        result.worker.profile !== "store-os-explorer" || result.worker.lens !== stage) {
      fail(`${stage} requiere findings[] y worker {id, profile: store-os-explorer, lens: ${stage}}`);
    }
  }
  if (stage === "plan") {
    if (!Array.isArray(result.ownedPaths) || result.ownedPaths.length === 0) fail("plan requiere ownedPaths[]");
    result.ownedPaths.forEach((entry) => relativeFile(ROOT, entry));
  }
  if (REVIEW_STAGES.includes(stage)) {
    if (!Array.isArray(result.findings)) fail(`${stage} requiere findings[]`);
    if (!result.reviewer || typeof result.reviewer.id !== "string" || !result.reviewer.id.trim() ||
        result.reviewer.profile !== "store-os-reviewer" || result.reviewer.lens !== REVIEW_LENSES[stage]) {
      fail(`${stage} requiere reviewer {id, profile: store-os-reviewer, lens: ${REVIEW_LENSES[stage]}}`);
    }
    for (const finding of result.findings) {
      if (!finding?.id || typeof finding.claim !== "string" || typeof finding.blocking !== "boolean" || !Array.isArray(finding.evidence)) {
        fail(`Hallazgo inválido en ${stage}`);
      }
      if (finding.blocking && finding.evidence.length === 0) fail(`Hallazgo bloqueante sin evidencia: ${finding.id}`);
    }
  }
  if (stage === "verifier") {
    if (!Array.isArray(result.findings)) fail("verifier requiere findings[]");
    if (!result.reviewer || typeof result.reviewer.id !== "string" || !result.reviewer.id.trim() ||
        result.reviewer.profile !== "store-os-reviewer" || result.reviewer.lens !== "adversarial") {
      fail("verifier requiere un reviewer adversarial identificado");
    }
    for (const finding of result.findings) {
      if (!finding?.reviewId || !finding?.findingId || !["confirmed", "uncertain", "refuted"].includes(finding.verdict)) {
        fail("Veredicto adversarial inválido");
      }
      if (finding.verdict === "refuted" && (!Array.isArray(finding.evidence) || finding.evidence.length === 0)) {
        fail(`Refutación sin evidencia reproducible: ${finding.findingId}`);
      }
    }
  }
}

function requireSubagentReceipt(root, runState, stage, result, sha) {
  if (!["discovery", "test-design", ...REVIEW_STAGES, "verifier"].includes(stage)) return null;
  const resultHash = hash(JSON.stringify(result));
  const file = path.join(runsDirectory(root), runState.runId, "receipts", `${resultHash}.json`);
  if (!fs.existsSync(file)) fail(`${stage} no tiene recibo de SubagentStop`, [resultHash]);
  const receipt = readJson(file);
  const identity = ["discovery", "test-design"].includes(stage) ? result.worker : result.reviewer;
  if (receipt.resultHash !== resultHash || receipt.agentId !== identity.id || receipt.agentType !== identity.profile || receipt.sha !== sha) {
    fail(`Recibo de subagente inválido para ${stage}`);
  }
  if (receipt.usedBy && receipt.usedBy !== stage) fail(`El recibo ya pertenece a ${receipt.usedBy}`);
  receipt.usedBy = stage;
  writeJson(file, receipt);
  return { agentId: receipt.agentId, agentType: receipt.agentType, resultHash, transcriptPath: receipt.transcriptPath };
}

function requireBootstrapReceipt(root, stage, result, sha) {
  const resultHash = hash(JSON.stringify(result));
  const file = path.join(root, ".delivery", "runs", "bootstrap", "receipts", `${resultHash}.json`);
  if (!fs.existsSync(file)) fail(`${stage} no tiene recibo de SubagentStop`, [resultHash]);
  const receipt = readJson(file);
  const identity = result.reviewer;
  if (receipt.resultHash !== resultHash || receipt.agentId !== identity.id || receipt.agentType !== identity.profile || receipt.sha !== sha) {
    fail(`Recibo de subagente inválido para ${stage}`);
  }
  if (receipt.usedBy && receipt.usedBy !== stage) fail(`El recibo ya pertenece a ${receipt.usedBy}`);
  receipt.usedBy = stage;
  writeJson(file, receipt);
  return { agentId: receipt.agentId, agentType: receipt.agentType, resultHash, transcriptPath: receipt.transcriptPath };
}

function receiptIntegrityBlockers(root, artifact, stage, sha, receiptsDirectory) {
  const blockers = [];
  if (!artifact?.receipt) return [`${stage} no contiene recibo verificable`];
  const { sha: artifactSha, recordedAt, receipt: linkedReceipt, ...result } = artifact;
  const resultHash = hash(JSON.stringify(result));
  const file = path.join(receiptsDirectory, `${resultHash}.json`);
  if (!fs.existsSync(file)) return [`Falta recibo original para ${stage}`];
  const receipt = readJson(file);
  const identity = result.worker || result.reviewer;
  if (artifactSha !== sha || receipt.sha !== sha) blockers.push(`${stage} y su recibo pertenecen a otro SHA`);
  if (linkedReceipt.resultHash !== resultHash || receipt.resultHash !== resultHash) blockers.push(`${stage} fue modificado después de SubagentStop`);
  if (linkedReceipt.agentId !== identity?.id || receipt.agentId !== identity?.id ||
      linkedReceipt.agentType !== identity?.profile || receipt.agentType !== identity?.profile) {
    blockers.push(`${stage} no coincide con la identidad emitida por SubagentStop`);
  }
  if (receipt.usedBy !== stage) blockers.push(`El recibo de ${stage} no quedó consumido por esa etapa`);
  if (linkedReceipt.transcriptPath !== receipt.transcriptPath) blockers.push(`El transcript de ${stage} no coincide con el recibo original`);
  return blockers;
}

function loadBootstrapHistory(root = ROOT) {
  const file = bootstrapStateFile(root, "history");
  if (fs.existsSync(file)) return readJson(file);
  if ([...REVIEW_STAGES, "verifier", "remote"].some((name) => fs.existsSync(bootstrapStateFile(root, name)))) {
    fail("El historial bootstrap falta aunque existen artefactos posteriores");
  }
  return { version: 1, state: "ACTIVE", correctionRounds: 0, correctionHeads: [], artifacts: {} };
}

function saveBootstrapHistory(root, history) {
  writeJson(bootstrapStateFile(root, "history"), history);
}

function bootstrapHistoricalReviewBlockers(root, history) {
  const blockers = [];
  const receipts = path.join(root, ".delivery", "runs", "bootstrap", "receipts");
  const verifiers = history.artifacts?.verifier || [];
  for (const stage of REVIEW_STAGES) {
    for (const review of history.artifacts?.[stage] || []) {
      blockers.push(...receiptIntegrityBlockers(root, review, stage, review.sha, receipts));
      const reviewerIds = REVIEW_STAGES.flatMap((reviewStage) => history.artifacts?.[reviewStage] || [])
        .filter((entry) => entry.sha === review.sha).map((entry) => entry.reviewer?.id);
      for (const finding of review.findings || []) {
        if (!finding.blocking) continue;
        const verifier = verifiers.find((entry) => entry.sha === review.sha && !reviewerIds.includes(entry.reviewer?.id) &&
          entry.findings.some((verdict) => verdict.reviewId === stage && verdict.findingId === finding.id));
        if (!verifier) blockers.push(`${stage}/${finding.id} de ${review.sha} no pasó por verificador adversarial`);
      }
    }
  }
  for (const verifier of verifiers) {
    blockers.push(...receiptIntegrityBlockers(root, verifier, "verifier", verifier.sha, receipts));
  }
  return blockers;
}

function requireRecordedPass(runState, stage) {
  const artifact = runState.artifacts[stage];
  if (!artifact || artifact.status !== "PASS") fail(`Falta ${stage} PASS antes de continuar`);
}

function enforceRecordTransition(root, runState, stage, sha) {
  if (["discovery", "test-design"].includes(stage)) {
    if (runState.verification.final) fail(`${stage} no puede cambiar después de verify final`);
    if (runState.artifacts.plan) fail(`${stage} no puede registrarse después del plan`);
    return;
  }
  if (stage === "plan") {
    if (runState.verification.final) fail("plan no puede cambiar después de verify final");
    requireRecordedPass(runState, "discovery");
    requireRecordedPass(runState, "test-design");
    return;
  }
  if (REVIEW_STAGES.includes(stage)) {
    requireRecordedPass(runState, "plan");
    const final = runState.verification.final;
    if (!final || final.sha !== sha || final.commands.some((entry) => entry.exitCode !== 0)) {
      fail(`${stage} requiere verify final vigente para ${sha}`);
    }
    if (!isTreeClean(root)) fail(`${stage} requiere un árbol limpio`);
    if (runState.artifacts[stage]?.sha === sha) fail(`${stage} ya fue registrado para este SHA`);
    return;
  }
  if (stage === "verifier") {
    if (!isTreeClean(root)) fail("verifier requiere un árbol limpio");
    const reviews = REVIEW_STAGES.map((reviewStage) => runState.artifacts[reviewStage]);
    if (reviews.some((review) => !review || review.sha !== sha)) fail("verifier requiere las tres revisiones vigentes");
    if (!reviews.some((review) => review.findings.some((finding) => finding.blocking))) {
      fail("verifier sólo se registra cuando existe un hallazgo bloqueante");
    }
    if (runState.artifacts.verifier?.sha === sha) fail("verifier ya fue registrado para este SHA");
  }
}

function changedFiles(root, baseSha) {
  const committed = git(root, ["diff", "--name-only", `${baseSha}...HEAD`]).stdout.split("\n");
  const working = git(root, ["diff", "--name-only", baseSha]).stdout.split("\n");
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).stdout.split("\n");
  return [...new Set([...committed, ...working, ...untracked].map((entry) => entry.trim()).filter(Boolean))];
}

function prFiles(pr) {
  return (pr.files || []).map((file) => typeof file === "string" ? file : file.path).filter(Boolean);
}

function overlaps(paths, prs, ownId) {
  const owned = new Set(paths);
  const conflicts = [];
  for (const pr of prs) {
    if (deliveryIdFromBody(pr.body) === ownId) continue;
    const shared = prFiles(pr).filter((file) => owned.has(file));
    if (shared.length) conflicts.push({ pr: pr.number, files: shared });
  }
  return conflicts;
}

function competingPullRequests(prs, runState) {
  return prs.filter((pr) => deliveryIdFromBody(pr.body) === runState.id && pr.headRefName !== runState.branch);
}

// Extract a reviewer result directly from the subagent transcript that produced a receipt, so the CLI
// never needs a hand-written input file (which the PreToolUse guard cannot always let through when the
// review text legitimately cites shell tokens or run-dir paths as evidence). The receipt already binds
// agentId + resultHash + sha; we re-derive the exact contract object from the transcript and re-check
// its canonical hash against the receipt before trusting it.
function readResultFromReceipt(root, stage, sha) {
  if (!REVIEW_STAGES.includes(stage)) fail(`${stage} no admite lectura desde recibo`);
  const lens = REVIEW_LENSES[stage];
  const hookPath = path.join(__dirname, "delivery-hook.cjs");
  if (!fs.existsSync(hookPath)) fail("readResultFromReceipt requiere scripts/delivery-hook.cjs junto al harness");
  const hook = require(hookPath);
  const dir = path.join(root, ".delivery", "runs", "bootstrap", "receipts");
  if (!fs.existsSync(dir)) fail(`${stage} no tiene recibo de SubagentStop`);
  function isNewer(a, b) { return String(a || "").localeCompare(String(b || "")) === 1; }
  let chosen = null;
  fs.readdirSync(dir).forEach(function (file) {
    if (!file.endsWith(".json")) return;
    const receipt = readJson(path.join(dir, file));
    if (!receipt || receipt.agentType !== "store-os-reviewer" || receipt.sha !== sha) return;
    if (receipt.usedBy && receipt.usedBy !== stage) return;
    if (!chosen || isNewer(receipt.recordedAt, chosen.recordedAt)) chosen = receipt;
  });
  if (!chosen) fail(`${stage} no tiene recibo de SubagentStop para ${sha}`);
  if (!chosen.transcriptPath || !fs.existsSync(chosen.transcriptPath)) fail(`${stage}: transcript ausente para el recibo`);
  const lines = fs.readFileSync(chosen.transcriptPath, "utf8").split(/\r?\n/);
  let value = null;
  lines.forEach(function (line) {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch (e) { return; }
    if (event.type !== "assistant") return;
    const message = event.message || {};
    const segments = Array.isArray(message.content) ? message.content : [message.content];
    segments.forEach(function (segment) {
      const text = typeof segment === "string" ? segment : (segment && segment.text);
      if (typeof text !== "string" || text.indexOf("{") === -1) return;
      const candidate = hook.parseContract(text, true);
      if (candidate && candidate.reviewer && candidate.reviewer.lens === lens) value = candidate;
    });
  });
  if (!value) fail(`${stage}: no se encontro contrato ${lens} en el transcript del recibo`);
  if (hash(JSON.stringify(value)) !== chosen.resultHash) fail(`${stage}: el hash del contrato del transcript no coincide con el recibo`);
  return { result: value, receipt: chosen };
}

function recordStage(root = ROOT, stage, resultFile, prs) {
  const active = loadActiveRun(root, false);
  if (!active && bootstrapDeclared(root)) {
    if (![...REVIEW_STAGES, "verifier"].includes(stage)) fail("Bootstrap sólo permite registrar revisiones finales");
    const blockers = bootstrapIdentityBlockers(root);
    if (blockers.length) fail("REVISIÓN BOOTSTRAP BLOQUEADA", blockers);
    const verification = readJson(bootstrapStateFile(root));
    const history = loadBootstrapHistory(root);
    if (history.state === "BLOCKED_HUMAN") fail("El bootstrap está BLOCKED_HUMAN", ["Sólo una persona puede retirar la evidencia bloqueada."]);
    const sha = currentSha(root);
    if (verification.state !== "FINAL_VERIFIED" || verification.sha !== sha) fail(`${stage} requiere verify bootstrap vigente para ${sha}`);
    if (!isTreeClean(root)) fail(`${stage} requiere un árbol limpio`);
    const result = resultFile === "--receipt" ? readResultFromReceipt(root, stage, sha).result : readJson(path.resolve(resultFile));
    validateRecord(stage, result);
    const reviewFile = bootstrapStateFile(root, stage);
    if (fs.existsSync(reviewFile) && readJson(reviewFile).sha === sha) fail(`${stage} ya fue registrado para este SHA`);
    if (stage === "verifier") {
      const reviews = REVIEW_STAGES.map((reviewStage) => fs.existsSync(bootstrapStateFile(root, reviewStage)) ? readJson(bootstrapStateFile(root, reviewStage)) : null);
      if (reviews.some((review) => !review || review.sha !== sha)) fail("verifier requiere las tres revisiones bootstrap vigentes");
      if (!reviews.some((review) => review.findings.some((finding) => finding.blocking))) fail("verifier sólo se registra cuando existe un hallazgo bloqueante");
    }
    const receipt = requireBootstrapReceipt(root, stage, result, sha);
    const artifact = { ...result, sha, recordedAt: new Date().toISOString(), receipt };
    history.artifacts[stage] ||= [];
    history.artifacts[stage].push(artifact);
    if (stage === "verifier") {
      const unresolved = artifact.findings.some((finding) => finding.verdict !== "refuted");
      if (unresolved && !history.correctionHeads.includes(sha)) {
        history.correctionHeads.push(sha);
        history.correctionRounds += 1;
        if (history.correctionRounds > 2) history.state = "BLOCKED_HUMAN";
      }
    }
    saveBootstrapHistory(root, history);
    writeJson(reviewFile, artifact);
    return artifact;
  }
  const runState = active || loadActiveRun(root);
  if (runState.state === "BLOCKED_HUMAN") fail("La corrida requiere intervención humana");
  if (resultFile === "--receipt") fail("--receipt sólo está soportado en bootstrap; pasa un result.json");
  const result = readJson(path.resolve(resultFile));
  validateRecord(stage, result);
  const sha = currentSha(root);
  enforceRecordTransition(root, runState, stage, sha);
  const receipt = requireSubagentReceipt(root, runState, stage, result, sha);
  if (stage === "plan") {
    const conflicts = overlaps(result.ownedPaths, prs || openPullRequests(root), runState.id);
    if (conflicts.length) fail("El plan comparte archivos con PRs abiertos", conflicts);
  }
  const artifact = { ...result, sha, recordedAt: new Date().toISOString(), ...(receipt ? { receipt } : {}) };
  runState.artifactHistory ||= {};
  runState.artifactHistory[stage] ||= [];
  runState.artifactHistory[stage].push(artifact);
  runState.artifacts[stage] = artifact;
  runState.headSha = sha;
  if (stage === "verifier") {
    const unresolved = artifact.findings.some((finding) => finding.verdict !== "refuted");
    if (unresolved && !runState.correctionHeads.includes(sha)) {
      runState.correctionHeads.push(sha);
      runState.correctionRounds += 1;
      if (runState.correctionRounds > 2) runState.state = "BLOCKED_HUMAN";
    }
  }
  runState.transitions.push({
    at: artifact.recordedAt,
    event: `RECORD_${stage.toUpperCase().replaceAll("-", "_")}`,
    from: runState.transitions.at(-1)?.to || "ACTIVE",
    to: runState.state,
    sha,
  });
  saveRun(root, runState);
  return artifact;
}

function historicalReviewBlockers(runState) {
  const blockers = [];
  const verifiers = runState.artifactHistory?.verifier || [];
  for (const stage of REVIEW_STAGES) {
    for (const review of runState.artifactHistory?.[stage] || []) {
      const reviewerIds = REVIEW_STAGES.flatMap((reviewStage) => runState.artifactHistory?.[reviewStage] || [])
        .filter((entry) => entry.sha === review.sha).map((entry) => entry.reviewer?.id);
      for (const finding of review.findings || []) {
        if (!finding.blocking) continue;
        const verifier = verifiers.find((entry) => entry.sha === review.sha && !reviewerIds.includes(entry.reviewer?.id) &&
          entry.findings.some((verdict) => verdict.reviewId === stage && verdict.findingId === finding.id));
        if (!verifier) blockers.push(`${stage}/${finding.id} de ${review.sha} no pasó por verificador adversarial`);
      }
    }
  }
  return blockers;
}

function verificationCommands(root, mode, files) {
  const packageJson = readJson(path.join(root, "package.json"));
  const required = mode === "quick" ? ["typecheck", "test"] : ["typecheck", "test", "build", "e2e"];
  if (mode === "final") {
    const firebaseChanged = files.some((file) =>
      /^(?:firebase\.json|\.firebaserc|firestore\.rules|storage\.rules|playwright\.firebase\.config\.[cm]?[jt]s|scripts\/(?!delivery-))/.test(file) ||
      /^src\/app\/firebase\//.test(file));
    const runtimeChanged = firebaseChanged || files.some((file) =>
      (/^src\//.test(file) && !/^src\/delivery\//.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) ||
      /^(e2e\/|firestore\.rules|storage\.rules|vite\.config\.|index\.html)/.test(file));
    if (runtimeChanged) required.push("e2e:firebase");
    if (files.some((file) => /^(?:firebase\.json|\.firebaserc|firestore\.rules|storage\.rules|scripts\/test-rules\.sh|src\/app\/firebase\/)/.test(file))) required.push("test:rules");
  }
  const commands = required.map((name) => {
    if (!packageJson.scripts?.[name]) fail(`Comando requerido inexistente: npm run ${name}`);
    return { name, ...npmInvocation(["--script-shell=/bin/sh", "run", name]) };
  });
  if (mode === "final" && files.some((file) => file === "package.json" || /(?:^|\/)package-lock\.json$/.test(file))) {
    commands.push({ name: "audit", ...npmInvocation(["audit", "--omit=dev", "--audit-level=high"]) });
  }
  return commands;
}

function executeCommands(root, commands, directory, prefix) {
  const evidence = [];
  for (const command of commands) {
    const started = Date.now();
    const result = run(command.command, command.args, { cwd: root, env: verificationEnvironment(), replaceEnv: true });
    const logFile = path.join(directory, `${prefix}-${command.name.replaceAll(":", "-")}.log`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, `${result.stdout}${result.stderr}`);
    evidence.push({
      name: command.name,
      command: result.command,
      exitCode: result.exitCode,
      durationMs: Date.now() - started,
      outputFile: path.relative(root, logFile),
    });
    if (result.exitCode !== 0) break;
  }
  return evidence;
}

function executeVerification(root = ROOT, mode) {
  if (!new Set(["quick", "final"]).has(mode)) fail("verify acepta quick o final");
  const runState = loadActiveRun(root);
  if (runState.state === "BLOCKED_HUMAN") fail("La corrida requiere intervención humana");
  requireRecordedPass(runState, "plan");
  if (mode === "final") {
    const blockers = historicalReviewBlockers(runState);
    if (blockers.length) fail("Hay hallazgos históricos sin verificación adversarial", blockers);
  }
  if (mode === "final" && !isTreeClean(root)) fail("verify final requiere un árbol limpio y un SHA candidato fijo");
  const sha = currentSha(root);
  const files = changedFiles(root, runState.baseSha);
  const commands = verificationCommands(root, mode, files);
  const evidence = executeCommands(root, commands, path.join(runsDirectory(root), runState.runId, "commands"), mode);
  const failed = evidence.some((entry) => entry.exitCode !== 0);

  if (mode === "final" && !isTreeClean(root)) fail("verify final dejó cambios en el árbol; la evidencia no pertenece al SHA candidato");

  runState.verification[mode] = { sha, recordedAt: new Date().toISOString(), files, commands: evidence };
  runState.headSha = sha;
  runState.transitions.push({
    at: runState.verification[mode].recordedAt,
    event: `VERIFY_${mode.toUpperCase()}`,
    from: runState.state,
    to: failed ? "ACTIVE" : `${mode.toUpperCase()}_VERIFIED`,
    sha,
  });
  if (!failed) runState.state = `${mode.toUpperCase()}_VERIFIED`;
  saveRun(root, runState);
  if (failed) fail(`verify ${mode} falló`, evidence.filter((entry) => entry.exitCode !== 0));
  return runState.verification[mode];
}

function bootstrapVerificationCommands(root = ROOT) {
  const packageJson = readJson(path.join(root, "package.json"));
  const commands = [{ name: "delivery-config", ...npmInvocation(["--script-shell=/bin/sh", "run", "delivery", "--", "check-config"]) }];
  for (const name of ["typecheck", "test", "build", "e2e", "e2e:firebase", "test:rules"]) {
    if (!packageJson.scripts?.[name]) fail(`Comando bootstrap inexistente: npm run ${name}`);
    commands.push({ name, ...npmInvocation(["--script-shell=/bin/sh", "run", name]) });
  }
  commands.push({ name: "audit", ...npmInvocation(["audit", "--omit=dev", "--audit-level=high"]) });
  return commands;
}

function executeBootstrapVerification(root = ROOT) {
  const blockers = bootstrapIdentityBlockers(root);
  const history = loadBootstrapHistory(root);
  if (history.state === "BLOCKED_HUMAN") blockers.push("El bootstrap está BLOCKED_HUMAN");
  blockers.push(...bootstrapHistoricalReviewBlockers(root, history));
  if (blockers.length) fail("VERIFY BOOTSTRAP BLOQUEADO", blockers);
  const manifest = loadBootstrapManifest(root);
  const sha = currentSha(root);
  const commands = bootstrapVerificationCommands(root);
  const evidence = executeCommands(root, commands, path.join(root, ".delivery", "runs", "bootstrap", "commands"), "final");
  const failed = evidence.some((entry) => entry.exitCode !== 0);
  if (!isTreeClean(root)) fail("verify bootstrap dejó cambios en el árbol; la evidencia quedó inválida");
  const state = {
    version: 1,
    id: manifest.id,
    state: failed ? "ACTIVE" : "FINAL_VERIFIED",
    baseSha: manifest.baseSha,
    sha,
    manifestHash: hash(fs.readFileSync(path.join(root, ".delivery", "bootstrap.json"))),
    files: changedFiles(root, manifest.baseSha).sort(),
    commands: evidence,
    recordedAt: new Date().toISOString(),
  };
  writeJson(bootstrapStateFile(root), state);
  if (failed) fail("verify bootstrap falló", evidence.filter((entry) => entry.exitCode !== 0));
  return state;
}

function artifactBlockers(root, runState, sha) {
  const blockers = [];
  const receipts = path.join(runsDirectory(root), runState.runId, "receipts");
  for (const stage of ["discovery", "test-design", "plan"]) {
    const artifact = runState.artifacts[stage];
    if (!artifact) blockers.push(`Falta record ${stage}`);
    else if (artifact.status !== "PASS") blockers.push(`${stage} no está PASS`);
    if (artifact?.receipt) blockers.push(...receiptIntegrityBlockers(root, artifact, stage, artifact.sha, receipts));
  }

  const blockingFindings = [];
  const reviewerIds = [];
  for (const stage of REVIEW_STAGES) {
    const review = runState.artifacts[stage];
    if (!review) {
      blockers.push(`Falta ${stage}`);
      continue;
    }
    blockers.push(...receiptIntegrityBlockers(root, review, stage, sha, receipts));
    if (review.sha !== sha) blockers.push(`${stage} pertenece a otro SHA`);
    if (review.status !== "PASS" && !(review.findings || []).some((finding) => finding.blocking)) {
      blockers.push(`${stage} no está PASS`);
    }
    if (review.reviewer?.profile !== "store-os-reviewer" || review.reviewer?.lens !== REVIEW_LENSES[stage]) {
      blockers.push(`${stage} no tiene procedencia de reviewer/lente válida`);
    } else {
      reviewerIds.push(review.reviewer.id);
    }
    for (const finding of review.findings || []) {
      if (finding.blocking) blockingFindings.push({ reviewId: stage, findingId: finding.id });
    }
  }

  if (reviewerIds.length === REVIEW_STAGES.length && new Set(reviewerIds).size !== REVIEW_STAGES.length) {
    blockers.push("Las tres revisiones deben provenir de reviewers independientes");
  }

  if (blockingFindings.length) {
    const verifier = runState.artifacts.verifier;
    if (!verifier || verifier.sha !== sha) {
      blockers.push("Falta verificador adversarial vigente");
    } else {
      blockers.push(...receiptIntegrityBlockers(root, verifier, "verifier", sha, receipts));
      if (verifier.status !== "PASS") blockers.push("El verificador adversarial no está PASS");
      if (verifier.reviewer?.profile !== "store-os-reviewer" || verifier.reviewer?.lens !== "adversarial" || reviewerIds.includes(verifier.reviewer?.id)) {
        blockers.push("El verificador adversarial debe ser independiente de los tres reviewers");
      }
      for (const finding of blockingFindings) {
        const verdict = verifier.findings.find((entry) => entry.reviewId === finding.reviewId && entry.findingId === finding.findingId);
        if (!verdict) blockers.push(`Hallazgo sin verificar: ${finding.reviewId}/${finding.findingId}`);
        else if (verdict.verdict !== "refuted") blockers.push(`Hallazgo ${verdict.verdict}: ${finding.reviewId}/${finding.findingId}`);
        else if (!verdict.evidence?.length) blockers.push(`Refutación sin evidencia: ${finding.reviewId}/${finding.findingId}`);
      }
    }
  }
  return blockers;
}

function publishBlockers(root = ROOT, prs = openPullRequests(root)) {
  const blockers = repositoryIdentityBlockers(root);
  let runState;
  try { runState = loadActiveRun(root); } catch (error) { return [error.message]; }
  if (runState.state === "BLOCKED_HUMAN") blockers.push("La corrida está BLOCKED_HUMAN");
  const sha = currentSha(root);
  if (!isTreeClean(root)) blockers.push("El árbol Git no está limpio");

  const queue = validateQueue(root);
  const ref = mainRef(root);
  let mainQueue;
  let item;
  try {
    mainQueue = loadQueueFromRef(root, ref);
    item = mainQueue.items.find((candidate) => candidate.id === runState.id);
  } catch (error) {
    blockers.push(error.message);
  }
  if (!item || !ownerApproved(item, root)) blockers.push("La entrega ya no está autorizada en main (queued, o awaiting-approval con spec mergeada por el owner)");
  if (completedIds(root, ref).has(runState.id)) blockers.push("La entrega ya fue completada en main");
  const competitors = competingPullRequests(prs, runState);
  for (const competitor of competitors) blockers.push(`PR competidor para ${runState.id}: #${competitor.number}`);
  if (item) {
    if (item.specPath !== runState.specPath) blockers.push("La ruta de la spec cambió desde begin");
    if (runState.queueItemHash !== hash(JSON.stringify(item))) blockers.push("La entrada de cola cambió desde begin");
    const missingDependencies = item.dependsOn.filter((dependency) => !completedIds(root, ref).has(dependency));
    if (missingDependencies.length) blockers.push(`Dependencias abiertas en main: ${missingDependencies.join(", ")}`);
    try {
      const spec = specFromMain(root, item);
      if (hash(spec.text) !== runState.specHash) blockers.push("La spec aprobada cambió desde begin");
    } catch (error) { blockers.push(error.message); }
  }

  const final = runState.verification.final;
  if (!final) blockers.push("Falta verify final");
  else {
    if (final.sha !== sha) blockers.push("verify final pertenece a otro SHA");
    if (!final.commands.length || final.commands.some((entry) => entry.exitCode !== 0)) blockers.push("verify final contiene comandos fallidos");
  }
  blockers.push(...artifactBlockers(root, runState, sha));
  if (runState.correctionRounds > 2) blockers.push("Se excedieron dos rondas de corrección");

  const marker = path.join(root, ".delivery", "completed", `${runState.id}.json`);
  if (!fs.existsSync(marker)) blockers.push(`Falta .delivery/completed/${runState.id}.json`);
  else {
    try {
      const value = readJson(marker);
      if (value.id !== runState.id || value.specPath !== runState.specPath || value.deliveryStatus !== "implemented") {
        blockers.push("El marcador completed no coincide con la entrega");
      }
    } catch (error) { blockers.push(error.message); }
  }

  const files = changedFiles(root, runState.baseSha);
  if (!files.length) blockers.push("La entrega no contiene cambios");
  if (files.includes(".delivery/queue.json")) blockers.push("Un PR de código no puede modificar .delivery/queue.json");
  if (files.includes(runState.specPath)) blockers.push("Un PR de código no puede modificar su spec aprobada");
  const allSpecPaths = new Set([
    ...queue.items.map((candidate) => candidate.specPath),
    ...(mainQueue?.items || []).map((candidate) => candidate.specPath),
  ]);
  const foreignSpecs = files.filter((file) => allSpecPaths.has(file) && file !== runState.specPath);
  if (foreignSpecs.length) blockers.push(`Un PR de código no puede modificar specs ajenas: ${foreignSpecs.join(", ")}`);
  const foreignMarkers = files.filter((file) => file.startsWith(".delivery/completed/") && file !== `.delivery/completed/${runState.id}.json`);
  if (foreignMarkers.length) blockers.push(`Marcadores completed ajenos: ${foreignMarkers.join(", ")}`);
  const planned = new Set(runState.artifacts.plan?.ownedPaths || []);
  const unplanned = files.filter((file) => !planned.has(file));
  if (unplanned.length) blockers.push(`Cambios fuera de ownedPaths: ${unplanned.join(", ")}`);
  const conflicts = overlaps(files, prs, runState.id);
  for (const conflict of conflicts) blockers.push(`Solapamiento con PR #${conflict.pr}: ${conflict.files.join(", ")}`);
  return blockers;
}

function bootstrapPublishBlockers(root = ROOT, prs = openPullRequests(root)) {
  const blockers = bootstrapIdentityBlockers(root);
  const history = loadBootstrapHistory(root);
  if (history.state === "BLOCKED_HUMAN") blockers.push("El bootstrap está BLOCKED_HUMAN");
  if (history.correctionRounds > 2) blockers.push("El bootstrap excedió dos rondas de corrección");
  blockers.push(...bootstrapHistoricalReviewBlockers(root, history));
  const manifest = (() => {
    try { return loadBootstrapManifest(root); } catch { return BOOTSTRAP; }
  })();
  let verification;
  try { verification = readJson(bootstrapStateFile(root)); } catch (error) {
    blockers.push("Falta npm run delivery -- verify bootstrap");
  }
  const sha = currentSha(root);
  if (verification) {
    if (verification.state !== "FINAL_VERIFIED") blockers.push("La verificación bootstrap no está verde");
    if (verification.sha !== sha) blockers.push("La verificación bootstrap pertenece a otro SHA");
    if (verification.baseSha !== manifest.baseSha) blockers.push("La verificación bootstrap pertenece a otra base");
    const manifestHash = hash(fs.readFileSync(path.join(root, ".delivery", "bootstrap.json")));
    if (verification.manifestHash !== manifestHash) blockers.push("El manifiesto bootstrap cambió después de verificar");
    if (JSON.stringify(verification.files) !== JSON.stringify(changedFiles(root, manifest.baseSha).sort())) blockers.push("El diff bootstrap cambió después de verificar");
    const expectedCommands = bootstrapVerificationCommands(root).map((entry) => [entry.command, ...entry.args].join(" "));
    if (!Array.isArray(verification.commands) ||
        JSON.stringify(verification.commands.map((entry) => entry.command)) !== JSON.stringify(expectedCommands) ||
        verification.commands.some((entry) => entry.exitCode !== 0)) {
      blockers.push("La evidencia bootstrap no contiene todos los comandos reales exitosos");
    }
  }
  const reviews = REVIEW_STAGES.map((stage) => {
    const file = bootstrapStateFile(root, stage);
    if (!fs.existsSync(file)) {
      blockers.push(`Falta ${stage} bootstrap`);
      return null;
    }
    const review = readJson(file);
    blockers.push(...receiptIntegrityBlockers(root, review, stage, sha, path.join(root, ".delivery", "runs", "bootstrap", "receipts")));
    if (review.sha !== sha) blockers.push(`${stage} bootstrap pertenece a otro SHA`);
    if (review.status !== "PASS" && !(review.findings || []).some((finding) => finding.blocking)) blockers.push(`${stage} bootstrap no está PASS`);
    if (review.reviewer?.profile !== "store-os-reviewer" || review.reviewer?.lens !== REVIEW_LENSES[stage]) {
      blockers.push(`${stage} bootstrap no tiene reviewer/lente válido`);
    }
    return review;
  });
  const reviewerIds = reviews.filter(Boolean).map((review) => review.reviewer?.id);
  if (reviewerIds.length === REVIEW_STAGES.length && new Set(reviewerIds).size !== REVIEW_STAGES.length) {
    blockers.push("Las tres revisiones bootstrap deben ser independientes");
  }
  const blockingFindings = reviews.flatMap((review, index) => (review?.findings || [])
    .filter((finding) => finding.blocking)
    .map((finding) => ({ reviewId: REVIEW_STAGES[index], findingId: finding.id })));
  if (blockingFindings.length) {
    const file = bootstrapStateFile(root, "verifier");
    if (!fs.existsSync(file)) blockers.push("Falta verificador adversarial bootstrap vigente");
    else {
      const verifier = readJson(file);
      blockers.push(...receiptIntegrityBlockers(root, verifier, "verifier", sha, path.join(root, ".delivery", "runs", "bootstrap", "receipts")));
      if (verifier.sha !== sha || verifier.status !== "PASS" || verifier.reviewer?.profile !== "store-os-reviewer" ||
          verifier.reviewer?.lens !== "adversarial" || reviewerIds.includes(verifier.reviewer?.id)) {
        blockers.push("El verificador adversarial bootstrap no es vigente e independiente");
      }
      for (const finding of blockingFindings) {
        const verdict = verifier.findings?.find((entry) => entry.reviewId === finding.reviewId && entry.findingId === finding.findingId);
        if (!verdict) blockers.push(`Falta veredicto para ${finding.reviewId}/${finding.findingId}`);
        else if (verdict.verdict !== "refuted") blockers.push(`${finding.reviewId}/${finding.findingId} quedó ${verdict.verdict}`);
        else if (!Array.isArray(verdict.evidence) || verdict.evidence.length === 0) blockers.push(`Refutación sin evidencia: ${finding.reviewId}/${finding.findingId}`);
      }
    }
  }
  const competitors = prs.filter((pr) => deliveryIdFromBody(pr.body) === manifest.id && pr.headRefName !== manifest.branch);
  for (const competitor of competitors) blockers.push(`PR bootstrap competidor: #${competitor.number}`);
  const conflicts = overlaps(changedFiles(root, manifest.baseSha), prs, manifest.id);
  for (const conflict of conflicts) blockers.push(`Solapamiento bootstrap con PR #${conflict.pr}: ${conflict.files.join(", ")}`);
  return blockers;
}

function specPublishBlockers(root = ROOT, prs = openPullRequests(root)) {
  const blockers = repositoryIdentityBlockers(root);
  const ref = mainRef(root);
  const baseSha = git(root, ["rev-parse", ref]).stdout.trim();
  const branch = currentBranch(root);
  if (!branch || branch === "main") blockers.push("La spec debe publicarse desde una rama");
  if (!isTreeClean(root)) blockers.push("El árbol Git no está limpio");

  let baseQueue;
  try {
    baseQueue = JSON.parse(git(root, ["show", `${ref}:.delivery/queue.json`]).stdout);
  } catch (error) {
    blockers.push("No se pudo leer la cola base de main");
  }
  let queue;
  try { queue = validateQueue(root); } catch (error) {
    blockers.push(error.message, ...(error.details || []));
  }
  // ponytail: accept a spec PR for ANY needs-spec item whose Delivery-ID has no open PR yet, not only the
  // first-priority one. Specs of different items touch disjoint files, so parallel spec PRs are safe and let the
  // agent batch-design the backlog instead of one-spec-at-a-time. The candidate is declared by this branch's own
  // queue transition (needs-spec -> awaiting-approval) for exactly one item.
  const baseById = new Map((baseQueue?.items || []).map(function (it) { return [it.id, it]; }));
  const promoted = (queue?.items || []).filter(function (it) {
    const base = baseById.get(it.id);
    return base && base.status === "needs-spec" && it.status === "awaiting-approval";
  });
  if (promoted.length === 0) {
    blockers.push("La rama no promueve ningún item needs-spec a awaiting-approval");
    return { blockers, item: null };
  }
  if (promoted.length > 1) {
    blockers.push("La rama promueve más de un item a awaiting-approval; un PR de spec es por item");
    return { blockers, item: null };
  }
  const candidate = promoted[0];
  if (prs.some(function (pr) { return deliveryIdFromBody(pr.body) === candidate.id; })) {
    blockers.push(`Ya existe un PR abierto para ${candidate.id}`);
    return { blockers, item: candidate };
  }
  const expectedQueue = JSON.parse(JSON.stringify(baseQueue));
  expectedQueue.items.find((item) => item.id === candidate.id).status = "awaiting-approval";
  if (JSON.stringify(queue) !== JSON.stringify(expectedQueue)) {
    blockers.push(`El PR de spec sólo puede cambiar el status de ${candidate.id} a awaiting-approval`);
  }
  const changed = changedFiles(root, baseSha).sort();
  const expected = [".delivery/queue.json", candidate.specPath].sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) blockers.push(`El PR de spec sólo puede cambiar: ${expected.join(", ")}`);
  const text = fs.existsSync(path.join(root, candidate.specPath)) ? fs.readFileSync(path.join(root, candidate.specPath), "utf8") : "";
  try {
    const metadata = validateSpec(candidate, text, "Pending approval");
    if (metadata.approvedBy) blockers.push("El agente no puede escribir Approved-By");
  } catch (error) { blockers.push(error.message, ...(error.details || [])); }
  return { blockers, item: candidate };
}

function revalidateRemote(root, remote, candidate) {
  if (!remote?.number) return ["Falta número de PR remoto"];
  const pr = pullRequest(root, remote.number);
  return remoteSnapshotBlockers(pr, { ...candidate, bodyRequirements: remote.bodyRequirements }, remote.sha, remote.previewUrl);
}

function relevantActiveRun(root = ROOT) {
  const active = loadActiveRun(root, false);
  return active?.state === "REMOTE_GREEN" && currentBranch(root) !== active.branch ? null : active;
}

function gate(root = ROOT, kind, prs) {
  if (kind === "publish") {
    const pullRequests = prs || openPullRequests(root);
    const active = relevantActiveRun(root);
    if (!active) {
      if (bootstrapDeclared(root)) {
        const blockers = bootstrapPublishBlockers(root, pullRequests);
        if (blockers.length) fail("PUBLICACIÓN BOOTSTRAP BLOQUEADA", blockers);
        const manifest = loadBootstrapManifest(root);
        const verification = readJson(bootstrapStateFile(root));
        return {
          allowed: true,
          gate: "publish",
          kind: "bootstrap",
          id: manifest.id,
          branch: manifest.branch,
          specPath: manifest.specPath,
          baseSha: manifest.baseSha,
          sha: currentSha(root),
          previewChecks: manifest.previewChecks,
          commands: verification.commands.map((entry) => entry.command),
        };
      }
      const spec = specPublishBlockers(root, pullRequests);
      if (spec.blockers.length) fail("PUBLICACIÓN DE SPEC BLOQUEADA", spec.blockers);
      return { allowed: true, gate: "publish", kind: "spec", id: spec.item.id, branch: currentBranch(root), sha: currentSha(root) };
    }
    const blockers = publishBlockers(root, pullRequests);
    if (blockers.length) fail("PUBLICACIÓN BLOQUEADA", blockers);
    const runState = loadActiveRun(root);
    return {
      allowed: true,
      gate: "publish",
      kind: "code",
      id: runState.id,
      branch: runState.branch,
      specPath: runState.specPath,
      sha: currentSha(root),
      commands: runState.verification.final.commands.map((entry) => entry.command),
    };
  }
  if (kind !== "stop") fail("gate acepta stop o publish");
  const runState = relevantActiveRun(root);
  if (!runState) {
    if (bootstrapDeclared(root)) {
      const history = loadBootstrapHistory(root);
      if (history.state === "BLOCKED_HUMAN") return { allowed: true, gate: "stop", reason: "BLOCKED_HUMAN" };
      const remote = fs.existsSync(bootstrapStateFile(root, "remote")) ? readJson(bootstrapStateFile(root, "remote")) : null;
      const blockers = bootstrapPublishBlockers(root, prs || openPullRequests(root));
      if (!remote || remote.state !== "REMOTE_GREEN") blockers.push("Bootstrap todavía no está REMOTE_GREEN");
      else if (remote.sha !== currentSha(root)) blockers.push("REMOTE_GREEN bootstrap pertenece a otro SHA");
      else blockers.push(...revalidateRemote(root, remote.remote, { id: BOOTSTRAP.id, branch: BOOTSTRAP.branch }));
      if (blockers.length) fail("STOP BOOTSTRAP BLOQUEADO", blockers);
      return { allowed: true, gate: "stop", reason: "BOOTSTRAP_REMOTE_GREEN" };
    }
    const branch = currentBranch(root);
    const pullRequests = prs || openPullRequests(root);
    if (!branch || branch === "main") {
      const next = nextDelivery(root, pullRequests);
      if (["EMPTY", "WAITING_SPEC_APPROVAL", "BLOCKED_DEPENDENCY"].includes(next.outcome)) {
        return { allowed: true, gate: "stop", reason: next.outcome };
      }
      if (next.outcome === "WAITING_PR" && next.item?.status === "needs-spec") {
        return { allowed: true, gate: "stop", reason: "WAITING_SPEC_APPROVAL" };
      }
      fail("STOP BLOQUEADO: la cola requiere una acción", [next.outcome, next.item?.id || "sin item"]);
    }
    const files = changedFiles(root, git(root, ["rev-parse", mainRef(root)]).stdout.trim());
    if (!files.length) {
      const next = nextDelivery(root, pullRequests);
      if (["EMPTY", "WAITING_SPEC_APPROVAL", "BLOCKED_DEPENDENCY"].includes(next.outcome)) {
        return { allowed: true, gate: "stop", reason: next.outcome };
      }
      fail("STOP BLOQUEADO: la cola requiere una acción", [next.outcome, next.item?.id || "sin item"]);
    }
    const spec = specPublishBlockers(root, []);
    if (spec.item && spec.blockers.length === 0 && pullRequests.some((pr) => deliveryIdFromBody(pr.body) === spec.item.id)) {
      return { allowed: true, gate: "stop", reason: "WAITING_SPEC_APPROVAL" };
    }
    fail("STOP BLOQUEADO: hay cambios fuera de una corrida activa", ["Ejecuta delivery next/begin o publica el draft PR de spec."]);
  }
  if (runState.state === "REMOTE_GREEN") {
    const sha = currentSha(root);
    const blockers = [];
    if (!isTreeClean(root)) blockers.push("El árbol cambió después de REMOTE_GREEN");
    if (runState.remote?.sha !== sha) blockers.push("HEAD ya no coincide con el SHA remoto verde");
    else blockers.push(...revalidateRemote(root, runState.remote, { id: runState.id, branch: runState.branch }));
    if (blockers.length) fail("STOP BLOQUEADO: REMOTE_GREEN quedó obsoleto", blockers);
    return { allowed: true, gate: "stop", reason: "REMOTE_GREEN" };
  }
  if (TERMINAL_STATES.has(runState.state)) return { allowed: true, gate: "stop", reason: runState.state };
  fail("STOP BLOQUEADO: la entrega no llegó a un estado terminal", [runState.state, ...publishBlockers(root, prs || openPullRequests(root))]);
}

function pullRequest(root, number) {
  const command = ghInvocation(root, ["pr", "view", String(number), "--json", "number,state,isDraft,body,baseRefName,headRefName,headRefOid,statusCheckRollup,comments,files,url,mergedAt"]);
  const result = run(command.command, command.args, { cwd: root });
  if (result.exitCode !== 0) fail(`No se pudo consultar el PR #${number}`, [result.stderr.trim()]);
  try { return JSON.parse(result.stdout); } catch { fail("gh devolvió un PR inválido"); }
}

function checkConclusion(check) {
  return (check.conclusion || check.state || "").toUpperCase();
}

function remoteSnapshotBlockers(pr, candidate, sha, expectedPreviewUrl = "") {
  const blockers = [];
  if (pr.state !== "OPEN" || pr.mergedAt) blockers.push("El PR remoto ya no está abierto y sin merge");
  if (!pr.isDraft) blockers.push("El PR remoto dejó de ser draft");
  if (pr.baseRefName !== "main") blockers.push(`El PR remoto apunta a ${pr.baseRefName || "una base desconocida"}, no main`);
  if (pr.headRefName !== candidate.branch) blockers.push(`La rama remota cambió a ${pr.headRefName || "desconocida"}`);
  if (pr.headRefOid !== sha) blockers.push(`El SHA remoto cambió: ${pr.headRefOid || "desconocido"}`);
  if (deliveryIdFromBody(pr.body) !== candidate.id) blockers.push("El Delivery-ID remoto cambió");
  for (const value of candidate.bodyRequirements || []) {
    if (!String(pr.body || "").includes(value)) blockers.push(`El cuerpo remoto perdió un marcador obligatorio: ${value}`);
  }
  const required = ["delivery-config", "build-test", "rules-and-e2e", "deploy"];
  for (const name of required) {
    if (!(pr.statusCheckRollup || []).some((check) => (check.name || check.context || "").includes(name) && checkConclusion(check) === "SUCCESS")) {
      blockers.push(`El check remoto ${name} ya no está SUCCESS`);
    }
  }
  if (expectedPreviewUrl && previewUrl(pr, sha) !== expectedPreviewUrl) blockers.push("El Preview remoto cambió o perdió su prueba de procedencia");
  return blockers;
}

function previewUrl(pr, sha) {
  for (const comment of pr.comments || []) {
    const author = String(comment.author?.login || comment.user?.login || "").toLowerCase();
    const body = String(comment.body || "");
    if (!new Set(["github-actions", "github-actions[bot]"]).has(author) || !body.includes(sha) || !/Preview deploy/i.test(body)) continue;
    const candidate = body.match(/https:\/\/[^\s)]+/i)?.[0] || "";
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && url.hostname.endsWith(".vercel.app")) return url.toString();
    } catch { /* ignore malformed or untrusted URLs */ }
  }
  return "";
}

async function browserChecks(url, checks) {
  if (!checks.length) return [];
  let chromium;
  try { ({ chromium } = require("@playwright/test")); } catch (error) { fail("Playwright no está disponible", [error.message]); }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const results = [];
    const previewOrigin = new URL(url).origin;
    for (const check of checks) {
      const target = new URL(check.path, url).toString();
      if (new URL(target).origin !== previewOrigin) fail("previewCheck intenta salir del origen del Preview", [target]);
      const response = await page.goto(target, { waitUntil: "domcontentloaded" });
      if (!response?.ok()) fail(`Preview respondió ${response?.status() || "sin respuesta"}`, [target]);
      if (new URL(page.url()).origin !== previewOrigin) fail("El Preview redirigió fuera de su origen", [page.url()]);
      const locator = page.locator(check.selector);
      await locator.waitFor({ state: "visible" });
      const content = await locator.innerText();
      if (!content.includes(check.text)) fail("El Preview no contiene el texto esperado", [target, check.selector, check.text]);
      results.push({ ...check, status: "PASS" });
    }
    return results;
  } finally {
    await browser.close();
  }
}

async function recordRemote(root = ROOT, number) {
  const candidate = gate(root, "publish");
  if (!new Set(["bootstrap", "code"]).has(candidate.kind)) fail("remote sólo acepta PRs de código o bootstrap");
  const bootstrap = candidate.kind === "bootstrap";
  const runState = bootstrap ? null : loadActiveRun(root);
  const pr = pullRequest(root, number);
  const sha = currentSha(root);
  if (pr.state !== "OPEN" || pr.mergedAt) fail("El PR debe estar abierto y sin merge");
  if (!pr.isDraft) fail("El PR debe permanecer draft");
  if (pr.baseRefName !== "main") fail("El PR debe apuntar a main", [String(pr.baseRefName || "sin base")]);
  if (pr.headRefName !== candidate.branch) fail("La rama remota del PR no coincide", [`remote=${pr.headRefName || "sin rama"}`, `local=${candidate.branch}`]);
  if (deliveryIdFromBody(pr.body) !== candidate.id) fail("Delivery-ID del PR no coincide");
  const requiredBodyValues = [candidate.specPath, sha, ...(candidate.commands || [])];
  if (bootstrap) requiredBodyValues.push(`Bootstrap-Base: ${candidate.baseSha}`);
  const missingBodyValues = requiredBodyValues.filter((value) => !String(pr.body || "").includes(value));
  if (missingBodyValues.length) fail("El cuerpo del PR no contiene la spec, SHA y comandos finales", missingBodyValues);
  if (pr.headRefOid !== sha) fail("El PR remoto apunta a otro SHA", [`remote=${pr.headRefOid}`, `local=${sha}`]);
  const checks = pr.statusCheckRollup || [];
  const pending = checks.filter((check) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(checkConclusion(check)));
  if (!checks.length || pending.length) fail("CI remoto no está verde", pending.map((check) => `${check.name || check.context}: ${checkConclusion(check) || check.status}`));
  const required = ["delivery-config", "build-test", "rules-and-e2e", "deploy"];
  const names = checks.map((check) => check.name || check.context || "");
  const failedRequired = required.filter((name) => !checks.some((check) =>
    (check.name || check.context || "").includes(name) && checkConclusion(check) === "SUCCESS"));
  if (failedRequired.length) fail("Los checks remotos obligatorios deben terminar SUCCESS", failedRequired);
  const url = previewUrl(pr, sha);
  if (!url) fail("Falta una URL de Preview vinculada al SHA actual en los comentarios del PR");
  const previewChecks = bootstrap
    ? candidate.previewChecks
    : loadQueueFromRef(root).items.find((item) => item.id === runState.id)?.previewChecks;
  if (!Array.isArray(previewChecks) || previewChecks.length === 0) fail("Faltan previewChecks obligatorios");
  const results = await browserChecks(url, previewChecks);
  const recordedAt = new Date().toISOString();
  const remote = { number: Number(number), url: pr.url, previewUrl: url, sha, checks: names, bodyRequirements: requiredBodyValues, recordedAt };
  if (bootstrap) {
    const state = {
      version: 1,
      id: candidate.id,
      state: "REMOTE_GREEN",
      baseSha: candidate.baseSha,
      sha,
      preview: { status: "PASS", url, checks: results, recordedAt },
      remote,
    };
    writeJson(bootstrapStateFile(root, "remote"), state);
    return remote;
  }
  runState.artifacts.preview = {
    status: "PASS",
    summary: "Preview verificado con navegador real",
    evidence: [url],
    url,
    checks: results,
    sha,
    recordedAt,
  };
  runState.remote = remote;
  runState.state = "REMOTE_GREEN";
  runState.transitions.push({ at: runState.remote.recordedAt, event: "REMOTE_GREEN", from: "FINAL_VERIFIED", to: "REMOTE_GREEN", sha });
  saveRun(root, runState);
  return runState.remote;
}

function checkConfig(root = ROOT) {
  validateQueue(root);
  const errors = [];
  if (fs.existsSync(path.join(root, ".delivery", "bootstrap.json"))) {
    try { loadBootstrapManifest(root); } catch (error) { errors.push(error.message, ...(error.details || [])); }
  }
  const packageJson = readJson(path.join(root, "package.json"));
  for (const script of ["delivery", "typecheck", "test", "build", "e2e", "e2e:firebase", "test:rules"]) {
    if (!packageJson.scripts?.[script]) errors.push(`Falta npm script: ${script}`);
  }
  if (packageJson.scripts?.delivery !== "node scripts/delivery-harness.cjs") errors.push("npm script delivery no apunta al CLI canónico");
  const skillA = path.join(root, ".agents", "skills", "store-os-delivery", "SKILL.md");
  const skillC = path.join(root, ".claude", "skills", "store-os-delivery", "SKILL.md");
  if (!fs.existsSync(skillA) || !fs.existsSync(skillC)) errors.push("Faltan las dos copias de store-os-delivery");
  else if (!fs.readFileSync(skillA).equals(fs.readFileSync(skillC))) errors.push("Las skills de Codex y Claude no son equivalentes");
  const interfaceA = path.join(root, ".agents", "skills", "store-os-delivery", "agents", "openai.yaml");
  const interfaceC = path.join(root, ".claude", "skills", "store-os-delivery", "agents", "openai.yaml");
  if (!fs.existsSync(interfaceA) || !fs.existsSync(interfaceC) || !fs.readFileSync(interfaceA).equals(fs.readFileSync(interfaceC))) {
    errors.push("Las interfaces de store-os-delivery no son equivalentes");
  }
  for (const file of [
    ".codex/agents/store-os-explorer.toml", ".codex/agents/store-os-reviewer.toml",
    ".claude/agents/store-os-explorer.md", ".claude/agents/store-os-reviewer.md",
    ".codex/hooks.json", ".claude/settings.json", "scripts/delivery-hook.cjs",
  ]) if (!fs.existsSync(path.join(root, file))) errors.push(`Falta configuración: ${file}`);
  try {
    const codexConfig = readJson(path.join(root, ".codex", "hooks.json"));
    const claudeConfig = readJson(path.join(root, ".claude", "settings.json"));
    if (JSON.stringify(Object.keys(codexConfig)) !== JSON.stringify(["hooks"])) errors.push(".codex/hooks.json sólo admite la clave hooks");
    const codexHooks = codexConfig.hooks;
    const claudeHooks = claudeConfig.hooks;
    if (JSON.stringify(codexHooks) !== JSON.stringify(claudeHooks)) errors.push("Codex y Claude no usan hooks equivalentes");
    // ponytail: hooks may be jointly disabled (owner decision, PR #18); both empty is a valid state
    const hooksDisabled = Object.keys(codexHooks ?? {}).length === 0;
    if (!hooksDisabled) for (const event of ["Stop", "SubagentStop", "PreToolUse"]) {
      if (!Array.isArray(codexHooks?.[event]) || codexHooks[event].length === 0) errors.push(`Hook faltante: ${event}`);
    }
  } catch (error) { errors.push(`Hooks inválidos: ${error.message}`); }
  for (const legacyAgent of ["implementer", "qa-executor", "workflow-simulator", "evidence-verifier", "security-hardener"]) {
    if (fs.existsSync(path.join(root, ".claude", "agents", `${legacyAgent}.md`))) errors.push(`Agente legado todavía presente: ${legacyAgent}`);
  }
  for (const legacy of [".claude/loops", ".claude/workflows", ".claude/schemas", "src/loops"]) {
    const directory = path.join(root, legacy);
    if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0) errors.push(`Workflow legado todavía presente: ${legacy}`);
  }
  if (errors.length) fail("Configuración del delivery harness inválida", errors);
  return { ok: true, items: loadQueue(root).items.length };
}

async function main(argv = process.argv.slice(2), root = ROOT) {
  const [command, first, second] = argv;
  if (["next", "begin", "gate", "remote"].includes(command) || (command === "verify" && first === "bootstrap")) syncMain(root);
  let result;
  if (command === "next") result = nextDelivery(root);
  else if (command === "begin") {
    if (!first) fail("Uso: delivery begin <id>");
    result = beginDelivery(root, first);
  } else if (command === "record") {
    if (!first || !second) fail("Uso: delivery record <stage> <result.json>");
    result = recordStage(root, first, second);
  } else if (command === "verify") result = first === "bootstrap" ? executeBootstrapVerification(root) : executeVerification(root, first);
  else if (command === "gate") result = gate(root, first);
  else if (command === "remote") {
    if (!/^\d+$/.test(first || "")) fail("Uso: delivery remote <pr-number>");
    result = await recordRemote(root, Number(first));
  } else if (command === "check-config") result = checkConfig(root);
  else fail("Comando desconocido", ["next | begin <id> | record <stage> <result.json> | verify quick|final|bootstrap | gate stop|publish | remote <pr-number> | check-config"]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  BOOTSTRAP,
  BOOTSTRAP_ALLOWED_PATHS,
  DeliveryError,
  artifactBlockers,
  browserChecks,
  checkConfig,
  completedIds,
  currentSha,
  deliveryIdFromBody,
  gate,
  hash,
  bootstrapIdentityBlockers,
  bootstrapPublishBlockers,
  executeBootstrapVerification,
  loadActiveRun,
  loadQueue,
  nextDelivery,
  openPullRequests,
  overlaps,
  publishBlockers,
  readResultFromReceipt,
  specMetadata,
  specPublishBlockers,
  validateQueue,
  validateRecord,
  verificationCommands,
};

if (require.main === module) {
  main().catch((error) => {
    const details = error.details?.length ? `\n${error.details.map((detail) => `- ${typeof detail === "string" ? detail : JSON.stringify(detail)}`).join("\n")}` : "";
    process.stderr.write(`${error.message}${details}\n`);
    process.exitCode = 2;
  });
}
