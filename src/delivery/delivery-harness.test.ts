import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const harness = require("../../scripts/delivery-harness.cjs");
const PROJECT_ROOT = process.cwd();
const ORIGINAL_PATH = process.env.PATH;

const roots: string[] = [];

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function writeJson(file: string, value: unknown) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function item(id: string, priority: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Entrega ${id}`,
    priority,
    status: "queued",
    specPath: `docs/${id}.md`,
    dependsOn: [],
    previewChecks: [{ path: "/", selector: "main", text: "Store OS" }],
    ...overrides,
  };
}

function initRepo(items = [item("one", 10)]) {
  const root = mkdtempSync(join(tmpdir(), "store-os-delivery-"));
  roots.push(root);
  mkdirSync(join(root, ".delivery"), { recursive: true });
  writeJson(join(root, ".delivery", "queue.json"), { version: 1, items });
  writeFileSync(join(root, ".gitignore"), ".delivery/runs/\n.test-bin/\n.test-gh-*.json\nnode_modules/\n");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(join(PROJECT_ROOT, "scripts", "delivery-harness.cjs"), join(root, "scripts", "delivery-harness.cjs"));
  writeJson(join(root, "package.json"), {
    scripts: {
      delivery: "node scripts/delivery-harness.cjs",
      typecheck: "true",
      test: "true",
      build: "true",
      e2e: "true",
      "e2e:firebase": "true",
      "test:rules": "true",
    },
  });
  for (const entry of items) {
    if (entry.status === "queued" || entry.status === "awaiting-approval") {
      const status = entry.status === "queued" ? "Approved\nApproved-By: Human Owner" : "Pending approval";
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, entry.specPath), `# Spec\n\nDelivery-ID: ${entry.id}\nDelivery-Status: ${status}\n`);
    }
  }
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Harness Test");
  git(root, "config", "user.email", "harness@example.com");
  git(root, "add", ".");
  git(root, "commit", "-m", "test: fixture");
  git(root, "remote", "add", "origin", root);
  git(root, "fetch", "origin", "main");
  const fake = installFakeGh(root, [], {});
  process.env.PATH = `${fake.bin}:${ORIGINAL_PATH}`;
  process.env.TEST_GH_OPEN_FILE = fake.openFile;
  process.env.TEST_GH_VIEW_FILE = fake.viewFile;
  process.env.TEST_GH_CLOSED_FILE = fake.closedFile;
  git(root, "switch", "-c", "delivery/one");
  return root;
}

function delivery(root: string, ...args: string[]) {
  const output = execFileSync(process.execPath, [join(root, "scripts", "delivery-harness.cjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(output);
}

function result(root: string, name: string, value: unknown) {
  const file = join(root, ".delivery", "runs", "inputs", `${name}.json`);
  writeJson(file, value);
  return file;
}

function pass(summary: string) {
  return { status: "PASS", summary, evidence: [`evidence:${summary}`] };
}

function explorerPass(id: string, lens: "discovery" | "test-design", summary: string) {
  return { ...pass(summary), findings: [], worker: { id, profile: "store-os-explorer", lens } };
}

function recordStage(root: string, stage: string, resultFile: string, prs: unknown[] = []) {
  const value = JSON.parse(readFileSync(resultFile, "utf8"));
  const identity = value.worker || value.reviewer;
  if (identity) {
    const active = JSON.parse(readFileSync(join(root, ".delivery", "runs", "active.json"), "utf8"));
    const resultHash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    writeJson(join(root, ".delivery", "runs", active.runId, "receipts", `${resultHash}.json`), {
      agentId: identity.id,
      agentType: identity.profile,
      resultHash,
      sha: git(root, "rev-parse", "HEAD"),
      transcriptPath: `/tmp/${identity.id}.jsonl`,
      recordedAt: new Date().toISOString(),
    });
  }
  void prs;
  return delivery(root, "record", stage, resultFile);
}

function installFakeGh(root: string, open: unknown[], view: unknown, closed: unknown[] = []) {
  const bin = join(root, ".test-bin");
  mkdirSync(bin, { recursive: true });
  const openFile = join(root, ".test-gh-open.json");
  const viewFile = join(root, ".test-gh-view.json");
  const closedFile = join(root, ".test-gh-closed.json");
  writeJson(openFile, open);
  writeJson(viewFile, view);
  writeJson(closedFile, closed);
  const executable = join(bin, "gh");
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const file = args[0] === "pr" && args[1] === "view"
  ? process.env.TEST_GH_VIEW_FILE
  : args.includes("closed") ? process.env.TEST_GH_CLOSED_FILE : process.env.TEST_GH_OPEN_FILE;
process.stdout.write(fs.readFileSync(file, "utf8"));
`);
  chmodSync(executable, 0o755);
  return { bin, openFile, viewFile, closedFile };
}

function installFakeNpm(root: string) {
  const executable = join(root, ".test-bin", "npm");
  writeFileSync(executable, `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.join(" ") === "run delivery -- check-config") {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "delivery-harness.cjs"), "check-config"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
process.exit(0);
`);
  chmodSync(executable, 0o755);
}

function initBootstrapRepo() {
  const root = mkdtempSync(join(tmpdir(), "store-os-bootstrap-"));
  roots.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Harness Test");
  git(root, "config", "user.email", "harness@example.com");

  const isNew = (file: string) => file.startsWith(".agents/") || file.startsWith(".codex/") ||
    file.startsWith(".delivery/") || file.startsWith("scripts/") || file.startsWith("src/delivery/") ||
    file.startsWith(".claude/skills/") || file === ".claude/settings.json" ||
    file.startsWith(".claude/agents/store-os-");
  const isLegacy = (file: string) => file.startsWith("src/loops/") || file.startsWith(".claude/loops/") ||
    file.startsWith(".claude/schemas/") || file.startsWith(".claude/workflows/") ||
    (file.startsWith(".claude/agents/") && !file.startsWith(".claude/agents/store-os-"));

  for (const file of harness.BOOTSTRAP_ALLOWED_PATHS as string[]) {
    if (!isNew(file)) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), file === ".gitignore" ? ".delivery/runs/\n.test-bin/\n.test-gh-*.json\nnode_modules/\nbase\n" : "base\n");
    }
  }
  writeJson(join(root, "package.json"), { name: "bootstrap-fixture", version: "1.0.0", scripts: { base: "true" } });
  writeJson(join(root, "package-lock.json"), {
    name: "bootstrap-fixture", version: "1.0.0", lockfileVersion: 3, requires: true,
    packages: { "": { name: "bootstrap-fixture", version: "1.0.0" } },
  });
  git(root, "add", ".");
  git(root, "commit", "-m", "test: pre-harness main");
  const baseSha = git(root, "rev-parse", "HEAD");
  git(root, "remote", "add", "origin", root);
  git(root, "fetch", "origin", "main");
  git(root, "switch", "-c", harness.BOOTSTRAP.branch);

  for (const file of harness.BOOTSTRAP_ALLOWED_PATHS as string[]) {
    if (isLegacy(file)) {
      rmSync(join(root, file));
      continue;
    }
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "candidate\n");
  }
  const harnessSource = readFileSync(join(PROJECT_ROOT, "scripts", "delivery-harness.cjs"), "utf8")
    .split(harness.BOOTSTRAP.baseSha).join(baseSha);
  writeFileSync(join(root, "scripts", "delivery-harness.cjs"), harnessSource);
  copyFileSync(join(PROJECT_ROOT, "scripts", "delivery-hook.cjs"), join(root, "scripts", "delivery-hook.cjs"));
  writeJson(join(root, "package.json"), {
    name: "bootstrap-fixture", version: "1.0.0",
    scripts: {
      delivery: "node scripts/delivery-harness.cjs", typecheck: "true", test: "true", build: "true", e2e: "true",
      "e2e:firebase": "true", "test:rules": "true",
    },
  });
  writeFileSync(join(root, ".gitignore"), ".delivery/runs/\n.test-bin/\n.test-gh-*.json\nnode_modules/\ncandidate\n");
  const skill = "---\nname: store-os-delivery\ndescription: fixture\n---\n";
  writeFileSync(join(root, ".agents", "skills", "store-os-delivery", "SKILL.md"), skill);
  writeFileSync(join(root, ".claude", "skills", "store-os-delivery", "SKILL.md"), skill);
  writeFileSync(join(root, ".agents", "skills", "store-os-delivery", "agents", "openai.yaml"), "interface: fixture\n");
  writeFileSync(join(root, ".claude", "skills", "store-os-delivery", "agents", "openai.yaml"), "interface: fixture\n");
  const hooks = { hooks: { Stop: [{}], SubagentStop: [{}], PreToolUse: [{}] } };
  writeJson(join(root, ".codex", "hooks.json"), hooks);
  writeJson(join(root, ".claude", "settings.json"), hooks);
  writeJson(join(root, ".delivery", "queue.json"), {
    version: 1,
    items: [item("later", 10, { status: "needs-spec", previewChecks: [] })],
  });
  writeJson(join(root, ".delivery", "bootstrap.json"), {
    version: 1, id: harness.BOOTSTRAP.id, branch: harness.BOOTSTRAP.branch, baseSha,
    specPath: harness.BOOTSTRAP.specPath, approvedBy: harness.BOOTSTRAP.approvedBy,
    previewChecks: harness.BOOTSTRAP.previewChecks,
  });
  writeFileSync(join(root, harness.BOOTSTRAP.specPath), "# Bootstrap harness\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "feat: install harness");

  const fake = installFakeGh(root, [], {});
  installFakeNpm(root);
  process.env.PATH = `${fake.bin}:${ORIGINAL_PATH}`;
  process.env.TEST_GH_OPEN_FILE = fake.openFile;
  process.env.TEST_GH_VIEW_FILE = fake.viewFile;
  process.env.TEST_GH_CLOSED_FILE = fake.closedFile;
  return { root, baseSha, fake };
}

function preparePublishable(root: string, standardFindings: unknown[] = []) {
  delivery(root, "begin", "one");
  recordStage(root, "discovery", result(root, "discovery", explorerPass("explorer-discovery", "discovery", "map")), []);
  recordStage(root, "test-design", result(root, "test-design", explorerPass("explorer-tests", "test-design", "tests")), []);
  recordStage(root, "plan", result(root, "plan", { ...pass("plan"), ownedPaths: ["src/value.ts", ".delivery/completed/one.json"] }), []);

  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "value.ts"), "export const value = 1;\n");
  writeJson(join(root, ".delivery", "completed", "one.json"), {
    id: "one",
    specPath: "docs/one.md",
    deliveryStatus: "implemented",
  });
  git(root, "add", ".");
  git(root, "commit", "-m", "feat: one");

  delivery(root, "verify", "final");
  const review = (id: string, lens: string, summary: string, findings: unknown[] = []) => ({
    ...pass(summary), findings, reviewer: { id, profile: "store-os-reviewer", lens },
  });
  recordStage(root, "review-standards", result(root, "standards", review("reviewer-standards", "standards-spec", "standards", standardFindings)), []);
  recordStage(root, "review-security", result(root, "security", review("reviewer-security", "security-privacy", "security")), []);
  recordStage(root, "review-qa", result(root, "qa", review("reviewer-qa", "qa-evidence", "qa")), []);
}

function recordBootstrapReview(root: string, stage: string, id: string, lens: string, findings: unknown[] = [], status = "PASS") {
  const value = { ...pass(stage), status, findings, reviewer: { id, profile: "store-os-reviewer", lens } };
  const file = result(root, `bootstrap-${stage}`, value);
  execFileSync(process.execPath, [join(root, "scripts", "delivery-hook.cjs")], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: "SubagentStop", cwd: root, agent_id: id, agent_type: "store-os-reviewer",
      agent_transcript_path: join(root, `${id}.jsonl`), last_assistant_message: JSON.stringify(value),
    }),
  });
  return delivery(root, "record", stage, file);
}

function recordBootstrapVerifier(root: string, id: string, reviewId: string, findingId: string, verdict = "uncertain") {
  const value = {
    ...pass("bootstrap verifier"),
    reviewer: { id, profile: "store-os-reviewer", lens: "adversarial" },
    findings: [{ reviewId, findingId, verdict, evidence: ["reproducción"] }],
  };
  const file = result(root, `bootstrap-verifier-${id}`, value);
  execFileSync(process.execPath, [join(root, "scripts", "delivery-hook.cjs")], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: "SubagentStop", cwd: root, agent_id: id, agent_type: "store-os-reviewer",
      agent_transcript_path: join(root, `${id}.jsonl`), last_assistant_message: JSON.stringify(value),
    }),
  });
  return delivery(root, "record", "verifier", file);
}

afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
  delete process.env.TEST_GH_OPEN_FILE;
  delete process.env.TEST_GH_VIEW_FILE;
  delete process.env.TEST_GH_CLOSED_FILE;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe.sequential("delivery harness", () => {
  it("instala el propio harness una sola vez con evidencia, draft PR, CI y Preview", async () => {
    const { root, baseSha, fake } = initBootstrapRepo();
    expect(() => delivery(root, "gate", "publish")).toThrow(/verify bootstrap/);
    expect(delivery(root, "verify", "bootstrap")).toMatchObject({ state: "FINAL_VERIFIED", baseSha });
    expect(() => delivery(root, "gate", "publish")).toThrow(/review-standards/);
    recordBootstrapReview(root, "review-standards", "bootstrap-standards", "standards-spec");
    recordBootstrapReview(root, "review-security", "bootstrap-security", "security-privacy");
    recordBootstrapReview(root, "review-qa", "bootstrap-qa", "qa-evidence");
    const manifest = delivery(root, "gate", "publish");
    expect(manifest).toMatchObject({ kind: "bootstrap", id: harness.BOOTSTRAP.id, baseSha });
    expect(() => delivery(root, "gate", "stop")).toThrow(/REMOTE_GREEN/);

    const sha = git(root, "rev-parse", "HEAD");
    writeJson(fake.viewFile, {
      number: 51, state: "OPEN", isDraft: true, mergedAt: null, baseRefName: "release",
      headRefName: harness.BOOTSTRAP.branch, headRefOid: sha,
      url: "https://example.test/pr/51", files: [],
      body: [`Delivery-ID: ${manifest.id}`, `Bootstrap-Base: ${baseSha}`, manifest.specPath, sha, ...manifest.commands].join("\n"),
      comments: [{ author: { login: "github-actions" }, body: `Preview deploy para ${sha}: https://store-os-bootstrap.vercel.app` }],
      statusCheckRollup: ["delivery-config", "build-test", "rules-and-e2e", "deploy"]
        .map((name) => ({ name, conclusion: "SUCCESS" })),
    });
    const fakePlaywright = join(root, "node_modules", "@playwright", "test");
    mkdirSync(fakePlaywright, { recursive: true });
    writeFileSync(join(fakePlaywright, "index.js"), `exports.chromium = { launch: async () => ({
      newPage: async () => ({ goto: async () => ({ ok: () => true }), locator: () => ({ waitFor: async () => {}, innerText: async () => "Entrar a Store OS" }) }),
      close: async () => {},
    }) };`);
    expect(() => delivery(root, "remote", "51")).toThrow(/apuntar a main/);
    const remotePr = JSON.parse(readFileSync(fake.viewFile, "utf8"));
    remotePr.baseRefName = "main";
    remotePr.headRefName = "attacker/bootstrap";
    writeJson(fake.viewFile, remotePr);
    expect(() => delivery(root, "remote", "51")).toThrow(/rama remota/);
    remotePr.headRefName = harness.BOOTSTRAP.branch;
    writeJson(fake.viewFile, remotePr);
    expect(delivery(root, "remote", "51")).toMatchObject({ number: 51, sha });
    expect(delivery(root, "gate", "stop")).toMatchObject({ reason: "BOOTSTRAP_REMOTE_GREEN" });
    remotePr.headRefOid = baseSha;
    writeJson(fake.viewFile, remotePr);
    expect(() => delivery(root, "gate", "stop")).toThrow(/SHA remoto cambió/);
    remotePr.headRefOid = sha;
    writeJson(fake.viewFile, remotePr);

    git(root, "switch", "main");
    writeFileSync(join(root, "main-advanced.txt"), "advanced\n");
    git(root, "add", "main-advanced.txt");
    git(root, "commit", "-m", "chore: advance main");
    git(root, "switch", harness.BOOTSTRAP.branch);
    expect(() => delivery(root, "gate", "publish")).toThrow(/Bootstrap expiró/);
  });

  it("conserva blockers bootstrap, verifica receipts y bloquea tras tres correcciones", () => {
    const { root } = initBootstrapRepo();
    const finding = { id: "B1", blocking: true, claim: "bypass", evidence: ["reproducción"] };
    for (let round = 1; round <= 3; round += 1) {
      delivery(root, "verify", "bootstrap");
      recordBootstrapReview(root, "review-standards", `standards-${round}`, "standards-spec", [finding], "FAIL");
      recordBootstrapReview(root, "review-security", `security-${round}`, "security-privacy");
      recordBootstrapReview(root, "review-qa", `qa-${round}`, "qa-evidence");
      recordBootstrapVerifier(root, `verifier-${round}`, "review-standards", "B1");
      if (round < 3) {
        writeFileSync(join(root, "AGENTS.md"), `candidate round ${round}\n`);
        git(root, "add", "AGENTS.md");
        git(root, "commit", "-m", `fix: bootstrap round ${round}`);
      }
    }
    expect(() => delivery(root, "gate", "publish")).toThrow(/BLOCKED_HUMAN|dos rondas/);

    const reviewFile = join(root, ".delivery", "runs", "bootstrap", "review-qa.json");
    const review = JSON.parse(readFileSync(reviewFile, "utf8"));
    review.summary = "manipulado";
    writeJson(reviewFile, review);
    expect(() => delivery(root, "gate", "publish")).toThrow(/Falta recibo original|modificado después de SubagentStop/);
  });

  it("rechaza IDs duplicados, specs sin aprobar y saltos de stage", () => {
    const duplicate = initRepo([item("one", 10), item("one", 20)]);
    expect(() => harness.validateQueue(duplicate)).toThrow(/cola inválida/i);

    const unapproved = initRepo([item("one", 10, { status: "awaiting-approval" })]);
    writeFileSync(join(unapproved, "docs", "one.md"), "Delivery-ID: one\nDelivery-Status: Approved\n");
    expect(() => harness.validateQueue(unapproved)).toThrow(/cola inválida/i);
    expect(() => harness.validateRecord("verification", pass("fake command"))).toThrow(/Stage no permitido/);

    const skipped = initRepo();
    delivery(skipped, "begin", "one");
    expect(() => recordStage(skipped, "plan", result(skipped, "early-plan", {
      ...pass("too early"), ownedPaths: ["src/value.ts"],
    }), [])).toThrow(/discovery PASS/);
  });

  it("record sólo acepta resultados con recibo emitido por SubagentStop", () => {
    const root = initRepo();
    delivery(root, "begin", "one");
    const value = explorerPass("agent-real-1", "discovery", "map");
    const file = result(root, "receipt-discovery", value);
    expect(() => delivery(root, "record", "discovery", file)).toThrow(/recibo de SubagentStop/);
    execFileSync(process.execPath, [join(process.cwd(), "scripts", "delivery-hook.cjs")], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({
        hook_event_name: "SubagentStop",
        cwd: root,
        agent_id: "agent-real-1",
        agent_type: "store-os-explorer",
        agent_transcript_path: join(root, "agent.jsonl"),
        last_assistant_message: JSON.stringify(value),
      }),
    });
    expect(delivery(root, "record", "discovery", file)).toMatchObject({ receipt: { agentId: "agent-real-1" } });
  });

  it("no permite comenzar ni proponer una spec fuera de prioridad", () => {
    const root = initRepo([item("one", 10, { status: "needs-spec" }), item("two", 20)]);
    expect(() => delivery(root, "begin", "two")).toThrow(/no es la siguiente entrega autorizada/);

    const queue = JSON.parse(readFileSync(join(root, ".delivery", "queue.json"), "utf8"));
    queue.items[1].status = "awaiting-approval";
    writeJson(join(root, ".delivery", "queue.json"), queue);
    writeFileSync(join(root, "docs", "two.md"), "Delivery-ID: two\nDelivery-Status: Pending approval\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "docs: skip one");
    expect(() => harness.gate(root, "publish", [])).toThrow(/SPEC BLOQUEADA/);
  });

  it("exige Preview real para cada entrega queued", () => {
    const root = initRepo([item("one", 10, { previewChecks: [] })]);
    expect(() => harness.validateQueue(root)).toThrow(/cola inválida/);
  });

  it("genera sólo la acción de spec y pausa el primer item", () => {
    const root = initRepo([item("one", 10, { status: "needs-spec" }), item("two", 20)]);
    const next = harness.nextDelivery(root, []);
    expect(next.outcome).toBe("DRAFT_SPEC");
    expect(next.item.id).toBe("one");
    expect(next.template["Delivery-Status"]).toBe("Pending approval");
  });

  it("autoriza el draft de spec sólo con spec pendiente y transición de cola", () => {
    const root = initRepo([item("one", 10, { status: "needs-spec" })]);
    const queue = JSON.parse(readFileSync(join(root, ".delivery", "queue.json"), "utf8"));
    queue.items[0].status = "awaiting-approval";
    writeJson(join(root, ".delivery", "queue.json"), queue);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "one.md"), "# Spec\n\nDelivery-ID: one\nDelivery-Status: Pending approval\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "docs: propose one");
    expect(harness.gate(root, "publish", [])).toMatchObject({ allowed: true, kind: "spec", id: "one" });

    writeFileSync(join(root, "src.ts"), "export {};\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "feat: forbidden implementation");
    expect(() => harness.gate(root, "publish", [])).toThrow(/SPEC BLOQUEADA/);
  });

  it("impide que un PR de spec altere otros items de la cola", () => {
    const root = initRepo([item("one", 10, { status: "needs-spec" }), item("two", 20, { status: "needs-spec" })]);
    const queue = JSON.parse(readFileSync(join(root, ".delivery", "queue.json"), "utf8"));
    queue.items[0].status = "awaiting-approval";
    queue.items[1].title = "Título alterado";
    writeJson(join(root, ".delivery", "queue.json"), queue);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "one.md"), "Delivery-ID: one\nDelivery-Status: Pending approval\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "docs: mutate queue");
    expect(() => harness.gate(root, "publish", [])).toThrow(/SPEC BLOQUEADA/);
  });

  it("no salta dependencias y detecta solapamiento con PRs abiertos", () => {
    const root = initRepo([item("one", 10, { dependsOn: ["two"] }), item("two", 20)]);
    expect(harness.nextDelivery(root, []).outcome).toBe("BLOCKED_DEPENDENCY");
    expect(harness.overlaps(["src/shared.ts"], [{ number: 8, body: "Delivery-ID: other", files: [{ path: "src/shared.ts" }] }], "one"))
      .toEqual([{ pr: 8, files: ["src/shared.ts"] }]);
  });

  it("rechaza PASS sin evidencia, comandos inexistentes y exit code no cero", () => {
    expect(() => harness.validateRecord("discovery", { status: "PASS", summary: "trust me", evidence: [] }))
      .toThrow(/autodeclarado/);
    const root = initRepo();
    delivery(root, "begin", "one");
    recordStage(root, "discovery", result(root, "commands-discovery", explorerPass("commands-discovery", "discovery", "map")), []);
    recordStage(root, "test-design", result(root, "commands-tests", explorerPass("commands-tests", "test-design", "tests")), []);
    recordStage(root, "plan", result(root, "commands-plan", { ...pass("plan"), ownedPaths: ["src/value.ts"] }), []);
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    delete packageJson.scripts.test;
    writeJson(join(root, "package.json"), packageJson);
    expect(() => delivery(root, "verify", "quick"))
      .toThrow(/inexistente/);
    packageJson.scripts.test = "false";
    writeJson(join(root, "package.json"), packageJson);
    expect(() => delivery(root, "verify", "quick")).toThrow(/falló/);
  });

  it("bloquea publish y stop cuando la entrega está incompleta", () => {
    const root = initRepo();
    delivery(root, "begin", "one");
    expect(() => harness.gate(root, "publish", [])).toThrow(/PUBLICACIÓN BLOQUEADA/);
    expect(() => harness.gate(root, "stop", [])).toThrow(/STOP BLOQUEADO/);
    expect(() => harness.validateRecord("complete", pass("fake complete"))).toThrow(/Stage no permitido/);
  });

  it("exige tres revisiones y bloquea hallazgos sin refutar", () => {
    const finding = { id: "S1", blocking: true, claim: "Isolation leak", evidence: ["src/value.ts:1"] };
    const root = initRepo();
    preparePublishable(root, [finding]);
    let blockers = harness.publishBlockers(root, []);
    expect(blockers).toContain("Falta verificador adversarial vigente");
    recordStage(root, "verifier", result(root, "verifier", {
      ...pass("verification"),
      reviewer: { id: "reviewer-adversarial", profile: "store-os-reviewer", lens: "adversarial" },
      findings: [{ reviewId: "review-standards", findingId: "S1", verdict: "uncertain", evidence: ["reproduction inconclusive"] }],
    }), []);
    blockers = harness.publishBlockers(root, []);
    expect(blockers.some((entry: string) => entry.includes("uncertain"))).toBe(true);
  });

  it("invalida validación y revisiones cuando cambia HEAD", () => {
    const root = initRepo();
    preparePublishable(root);
    expect(harness.publishBlockers(root, [])).toEqual([]);
    writeFileSync(join(root, "src", "value.ts"), "export const value = 2;\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "fix: change head");
    const blockers = harness.publishBlockers(root, []);
    expect(blockers).toContain("verify final pertenece a otro SHA");
    expect(blockers).toContain("review-standards pertenece a otro SHA");
  });

  it("rechaza artefactos de review manipulados después de SubagentStop", () => {
    const root = initRepo();
    preparePublishable(root);
    const active = harness.loadActiveRun(root);
    const runFile = join(root, ".delivery", "runs", active.runId, "run.json");
    const run = JSON.parse(readFileSync(runFile, "utf8"));
    run.artifacts["review-qa"].summary = "manipulado";
    writeJson(runFile, run);
    expect(harness.publishBlockers(root, []).some((entry: string) =>
      /Falta recibo original para review-qa|review-qa fue modificado después de SubagentStop/.test(entry))).toBe(true);
  });

  it("un PR de código no puede cambiar cola, spec ni completar otros IDs", () => {
    const root = initRepo([item("one", 10), item("two", 20)]);
    preparePublishable(root);
    const queue = JSON.parse(readFileSync(join(root, ".delivery", "queue.json"), "utf8"));
    queue.items[1].title = "alterado";
    writeJson(join(root, ".delivery", "queue.json"), queue);
    writeFileSync(join(root, "docs", "one.md"), "Delivery-ID: one\nDelivery-Status: Approved\nApproved-By: Human Owner\nCambio indebido\n");
    writeFileSync(join(root, "docs", "two.md"), "Delivery-ID: two\nDelivery-Status: Approved\nApproved-By: Human Owner\nCambio indebido\n");
    writeJson(join(root, ".delivery", "completed", "two.json"), {
      id: "two", specPath: "docs/two.md", deliveryStatus: "implemented",
    });
    git(root, "add", ".");
    git(root, "commit", "-m", "test: forbidden collateral changes");
    const blockers = harness.publishBlockers(root, []);
    expect(blockers).toContain("Un PR de código no puede modificar .delivery/queue.json");
    expect(blockers).toContain("Un PR de código no puede modificar su spec aprobada");
    expect(blockers.some((entry: string) => entry.includes("specs ajenas") && entry.includes("docs/two.md"))).toBe(true);
    expect(blockers.some((entry: string) => entry.includes("Marcadores completed ajenos"))).toBe(true);
  });

  it("invalida publish si main completa o revoca el item después de begin", () => {
    const completed = initRepo();
    preparePublishable(completed);
    git(completed, "switch", "main");
    writeJson(join(completed, ".delivery", "completed", "one.json"), {
      id: "one", specPath: "docs/one.md", deliveryStatus: "implemented",
    });
    git(completed, "add", ".delivery/completed/one.json");
    git(completed, "commit", "-m", "feat: complete one elsewhere");
    git(completed, "switch", "delivery/one");
    expect(() => delivery(completed, "gate", "publish")).toThrow(/completada en main/);

    const frozen = initRepo();
    preparePublishable(frozen);
    git(frozen, "switch", "main");
    const queue = JSON.parse(readFileSync(join(frozen, ".delivery", "queue.json"), "utf8"));
    queue.items[0].status = "frozen";
    writeJson(join(frozen, ".delivery", "queue.json"), queue);
    git(frozen, "add", ".delivery/queue.json");
    git(frozen, "commit", "-m", "chore: freeze one");
    git(frozen, "switch", "delivery/one");
    expect(() => delivery(frozen, "gate", "publish")).toThrow(/no está queued en main|entrada de cola cambió/);
  });

  it("bloquea un PR competidor para el mismo Delivery-ID creado después de begin", () => {
    const root = initRepo();
    preparePublishable(root);
    const blockers = harness.publishBlockers(root, [{
      number: 99,
      headRefName: "other/one",
      body: "Delivery-ID: one",
      files: [],
    }]);
    expect(blockers).toContain("PR competidor para one: #99");
  });

  it("bloquea a una persona después de más de dos rondas de corrección", () => {
    const root = initRepo();
    const finding = { id: "S1", blocking: true, claim: "Still broken", evidence: ["src/value.ts:1"] };
    preparePublishable(root, [finding]);
    for (let round = 1; round <= 3; round += 1) {
      recordStage(root, "verifier", result(root, `verifier-${round}`, {
        ...pass(`round ${round}`),
        reviewer: { id: `reviewer-adversarial-${round}`, profile: "store-os-reviewer", lens: "adversarial" },
        findings: [{ reviewId: "review-standards", findingId: "S1", verdict: "confirmed", evidence: ["failed test"] }],
      }), []);
      if (round < 3) {
        writeFileSync(join(root, `round-${round}.txt`), `${round}\n`);
        git(root, "add", ".");
        git(root, "commit", "-m", `fix: round ${round}`);
        delivery(root, "verify", "final");
        const review = (id: string, lens: string, findings: unknown[] = []) => ({
          ...pass(id), findings, reviewer: { id: `${id}-${round}`, profile: "store-os-reviewer", lens },
        });
        recordStage(root, "review-standards", result(root, `standards-${round}`, review("standards", "standards-spec", [finding])), []);
        recordStage(root, "review-security", result(root, `security-${round}`, review("security", "security-privacy")), []);
        recordStage(root, "review-qa", result(root, `qa-${round}`, review("qa", "qa-evidence")), []);
      }
    }
    expect(harness.loadActiveRun(root).state).toBe("BLOCKED_HUMAN");
  });

  it("reintenta un PR cerrado, omite merged y sólo avanza tras remoto verde", () => {
    const entries = [item("one", 10), item("two", 20)];
    const retry = initRepo(entries);
    delivery(retry, "begin", "one");
    git(retry, "switch", "main");
    git(retry, "switch", "-c", "delivery/retry");
    const closed = [{ number: 7, body: "Delivery-ID: one", mergedAt: null }];
    expect(harness.nextDelivery(retry, [], closed)).toMatchObject({ outcome: "READY", retry: true });
    const retryGh = installFakeGh(retry, [], {}, closed);
    process.env.PATH = `${retryGh.bin}:${ORIGINAL_PATH}`;
    process.env.TEST_GH_OPEN_FILE = retryGh.openFile;
    process.env.TEST_GH_VIEW_FILE = retryGh.viewFile;
    process.env.TEST_GH_CLOSED_FILE = retryGh.closedFile;
    expect(delivery(retry, "begin", "one").branch)
      .toBe("delivery/retry");

    const merged = initRepo(entries);
    git(merged, "switch", "main");
    writeJson(join(merged, ".delivery", "completed", "one.json"), {
      id: "one", specPath: "docs/one.md", deliveryStatus: "implemented",
    });
    git(merged, "add", ".");
    git(merged, "commit", "-m", "feat: merge one");
    expect(delivery(merged, "next").item.id).toBe("two");

    const unmerged = initRepo(entries);
    writeJson(join(unmerged, ".delivery", "completed", "one.json"), {
      id: "one", specPath: "docs/one.md", deliveryStatus: "implemented",
    });
    expect(harness.nextDelivery(unmerged, []).item.id).toBe("one");

    const green = initRepo(entries);
    delivery(green, "begin", "one");
    const active = JSON.parse(readFileSync(join(green, ".delivery", "runs", "active.json"), "utf8"));
    const runFile = join(green, ".delivery", "runs", active.runId, "run.json");
    const run = JSON.parse(readFileSync(runFile, "utf8"));
    run.state = "REMOTE_GREEN";
    writeJson(runFile, run);
    const open = [{ number: 1, url: "https://example.test/pr/1", body: "Delivery-ID: one", files: [] }];
    expect(harness.nextDelivery(green, open).item.id).toBe("two");
  });

  it("comprueba CI y Preview antes de marcar remoto verde", async () => {
    const root = initRepo([
      item("one", 10, { previewChecks: [{ path: "/catalogo", selector: "main", text: "Catálogo" }] }),
      item("two", 20),
    ]);
    preparePublishable(root);
    const sha = git(root, "rev-parse", "HEAD");
    const manifest = harness.loadActiveRun(root);
    const remotePr = {
      number: 41,
      state: "OPEN",
      isDraft: true,
      baseRefName: "main",
      headRefName: "delivery/one",
      body: [`Delivery-ID: one`, "docs/one.md", sha, ...manifest.verification.final.commands.map((entry: { command: string }) => entry.command)].join("\n"),
      headRefOid: sha,
      mergedAt: null,
      url: "https://example.test/pr/41",
      files: [],
      comments: [{ author: { login: "github-actions" }, body: `Preview deploy para ${sha}: https://store-os-one.vercel.app` }],
      statusCheckRollup: ["delivery-config", "build-test", "rules-and-e2e", "deploy"].map((name) => ({ name, conclusion: "SUCCESS" })),
    };
    const fake = installFakeGh(root, [], remotePr);
    const oldPath = process.env.PATH;
    const oldOpen = process.env.TEST_GH_OPEN_FILE;
    const oldView = process.env.TEST_GH_VIEW_FILE;
    process.env.PATH = `${fake.bin}:${oldPath}`;
    process.env.TEST_GH_OPEN_FILE = fake.openFile;
    process.env.TEST_GH_VIEW_FILE = fake.viewFile;
    const fakePlaywright = join(root, "node_modules", "@playwright", "test");
    mkdirSync(fakePlaywright, { recursive: true });
    writeFileSync(join(fakePlaywright, "index.js"), `
const fs = require("node:fs");
exports.chromium = { launch: async () => {
  fs.writeFileSync(require("node:path").join(process.cwd(), ".delivery", "runs", "browser-launched"), "yes");
  return { newPage: async () => ({
    goto: async () => ({ ok: () => true }),
    locator: () => ({ waitFor: async () => {}, innerText: async () => "Catálogo Store OS" }),
  }), close: async () => {} };
} };
`);
    try {
      writeJson(fake.viewFile, {
        ...remotePr,
        comments: [
          { author: { login: "agent-user" }, body: `Preview deploy para ${sha}: https://store-os-one.vercel.app` },
          { author: { login: "github-actions" }, body: `Preview deploy para ${sha}: https://preview.example.test` },
        ],
      });
      expect(() => delivery(root, "remote", "41")).toThrow(/URL de Preview/);
      writeJson(fake.viewFile, remotePr);
      delivery(root, "remote", "41");
      expect(existsSync(join(root, ".delivery", "runs", "browser-launched"))).toBe(true);
      expect(harness.loadActiveRun(root).state).toBe("REMOTE_GREEN");
      expect(harness.gate(root, "stop", [])).toMatchObject({ allowed: true, reason: "REMOTE_GREEN" });
      const open = [{ number: 41, url: "https://example.test/pr/41", body: "Delivery-ID: one", files: [] }];
      expect(harness.nextDelivery(root, open).item.id).toBe("two");
      writeFileSync(join(root, "after-green.txt"), "stale\n");
      expect(() => harness.gate(root, "stop", [])).toThrow(/obsoleto/);
    } finally {
      process.env.PATH = oldPath;
      if (oldOpen === undefined) delete process.env.TEST_GH_OPEN_FILE; else process.env.TEST_GH_OPEN_FILE = oldOpen;
      if (oldView === undefined) delete process.env.TEST_GH_VIEW_FILE; else process.env.TEST_GH_VIEW_FILE = oldView;
    }

    const skipped = initRepo([item("one", 10)]);
    preparePublishable(skipped);
    const skippedSha = git(skipped, "rev-parse", "HEAD");
    const skippedManifest = harness.loadActiveRun(skipped);
    const skippedPr = { ...remotePr, number: 42, headRefOid: skippedSha,
        body: [`Delivery-ID: one`, "docs/one.md", skippedSha,
          ...skippedManifest.verification.final.commands.map((entry: { command: string }) => entry.command)].join("\n"),
        comments: [{ author: { login: "github-actions[bot]" }, body: `Preview deploy para ${skippedSha}: https://store-os-skipped.vercel.app` }],
        statusCheckRollup: ["delivery-config", "build-test", "rules-and-e2e", "deploy"].map((name) => ({ name, conclusion: "SKIPPED" })) };
    const skippedFake = installFakeGh(skipped, [], skippedPr);
    process.env.PATH = `${skippedFake.bin}:${oldPath}`;
    process.env.TEST_GH_OPEN_FILE = skippedFake.openFile;
    process.env.TEST_GH_VIEW_FILE = skippedFake.viewFile;
    process.env.TEST_GH_CLOSED_FILE = skippedFake.closedFile;
    try {
      expect(() => delivery(skipped, "remote", "42")).toThrow(/CI remoto no está verde|deben terminar SUCCESS/);
    } finally {
      process.env.PATH = oldPath;
      delete process.env.TEST_GH_OPEN_FILE;
      delete process.env.TEST_GH_VIEW_FILE;
    }
  });

  it("exige árbol limpio para verify final y revisiones", () => {
    const root = initRepo();
    delivery(root, "begin", "one");
    recordStage(root, "discovery", result(root, "dirty-discovery", explorerPass("dirty-discovery", "discovery", "map")), []);
    recordStage(root, "test-design", result(root, "dirty-tests", explorerPass("dirty-tests", "test-design", "tests")), []);
    recordStage(root, "plan", result(root, "dirty-plan", { ...pass("plan"), ownedPaths: ["dirty.ts"] }), []);
    writeFileSync(join(root, "dirty.ts"), "export {};\n");
    expect(() => delivery(root, "verify", "final"))
      .toThrow(/árbol limpio/);
  });

  it("gate stop no permite abandonar backlog y BLOCKED_HUMAN no se reinicia", () => {
    const pending = initRepo([item("one", 10, { status: "needs-spec" })]);
    git(pending, "switch", "main");
    expect(() => harness.gate(pending, "stop", [])).toThrow(/cola requiere una acción/);

    const blocked = initRepo();
    delivery(blocked, "begin", "one");
    const active = JSON.parse(readFileSync(join(blocked, ".delivery", "runs", "active.json"), "utf8"));
    const runFile = join(blocked, ".delivery", "runs", active.runId, "run.json");
    const run = JSON.parse(readFileSync(runFile, "utf8"));
    run.state = "BLOCKED_HUMAN";
    writeJson(runFile, run);
    expect(() => delivery(blocked, "begin", "one")).toThrow(/BLOCKED_HUMAN/);
  });

  it("incluye Firebase E2E para cualquier superficie runtime", () => {
    for (const file of ["src/main.tsx", "src/index.css", "src/security/guard.ts"]) {
      expect(harness.verificationCommands(process.cwd(), "final", [file]).map((entry: { name: string }) => entry.name))
        .toContain("e2e:firebase");
    }
  });

  it("mantiene equivalentes las skills de Codex y Claude", () => {
    expect(readFileSync(join(process.cwd(), ".agents", "skills", "store-os-delivery", "SKILL.md"), "utf8"))
      .toBe(readFileSync(join(process.cwd(), ".claude", "skills", "store-os-delivery", "SKILL.md"), "utf8"));
  });
});
