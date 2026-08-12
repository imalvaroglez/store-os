import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const hook = require("../../scripts/delivery-hook.cjs");
const root = process.cwd();

describe("delivery lifecycle hook", () => {
  it("acepta sólo el contrato JSON completo de subagente", () => {
    const valid = JSON.stringify({ status: "PASS", summary: "reviewed", evidence: ["src/file.ts:1"], findings: [] });
    expect(hook.parseContract(valid)).toMatchObject({ status: "PASS" });
    expect(hook.parseContract("```json\n{}\n```" )).toBeNull();
    expect(hook.parseContract(JSON.stringify({ status: "PASS", summary: "trust me", evidence: [], findings: [] }))).toBeNull();
    expect(hook.handle({ hook_event_name: "SubagentStop", cwd: root, last_assistant_message: valid })).toBe("");
    expect(hook.handle({ hook_event_name: "SubagentStop", cwd: root, last_assistant_message: "not json" })).toMatch(/único objeto JSON/);
    expect(hook.handle({ hook_event_name: "SubagentStop", agent_type: "store-os-reviewer", cwd: root,
      last_assistant_message: valid })).toMatch(/único objeto JSON/);
  });

  it("bloquea merge, push a main, deploy y operaciones productivas", () => {
    expect(hook.forbiddenCommand("gh pr merge 22 --squash", root)).toMatch(/Merge/);
    expect(hook.forbiddenCommand("git push origin HEAD:main", root)).toMatch(/main/);
    expect(hook.forbiddenCommand("git -C /tmp/repo push origin codex/work:main", root)).toMatch(/main/);
    expect(hook.forbiddenCommand("/usr/bin/git -C /tmp/repo merge origin/main", root)).toMatch(/Merge/);
    expect(hook.forbiddenCommand("git --no-pager push origin HEAD:main", root)).toMatch(/main/);
    expect(hook.forbiddenCommand("git -c alias.ship=push ship origin HEAD:main", root)).toMatch(/alias/);
    expect(hook.forbiddenCommand("git -c alias.ship='push' ship origin HEAD:main", root)).toMatch(/alias/);
    expect(hook.forbiddenCommand("SHIP=push git --config-env=alias.ship=SHIP ship origin HEAD:main", root)).toMatch(/alias/);
    expect(hook.forbiddenCommand("git -c user.name=x -c alias.ship='push' ship origin HEAD:main", root)).toMatch(/alias/);
    expect(hook.forbiddenCommand("SHIP=push git -c user.name=x --config-env=alias.ship=SHIP ship origin HEAD:main", root)).toMatch(/alias/);
    expect(hook.forbiddenCommand("git push origin :main", root)).toMatch(/main/);
    expect(hook.forbiddenCommand("git push --mirror origin", root)).toMatch(/main/);
    expect(hook.forbiddenCommand("git push --all origin", root)).toMatch(/main/);
    expect(hook.forbiddenCommand("git send-pack origin HEAD:refs/heads/main", root)).toMatch(/send-pack/);
    expect(hook.forbiddenCommand('op=push; git "$op" origin HEAD:main', root)).toMatch(/dinámicos/);
    expect(hook.forbiddenCommand("gh repo sync owner/store-os --source attacker/fork --branch main --force", root)).toMatch(/repo sync/);
    expect(hook.forbiddenCommand("vercel deploy --prod", root)).toMatch(/deploys/);
    expect(hook.forbiddenCommand("firebase --project store-os-dev deploy", root)).toMatch(/deploys/);
    expect(hook.forbiddenCommand("firebase firestore:delete --all-collections --force", root)).toMatch(/Firebase Emulator/);
    expect(hook.forbiddenCommand("firebase emulators:start; firebase firestore:delete --all-collections --force", root)).toMatch(/Firebase Emulator/);
    expect(hook.forbiddenCommand("firebase emulators:exec 'env -u FIRESTORE_EMULATOR_HOST firebase firestore:delete --all-collections --force'", root)).toMatch(/emulators:exec/);
    expect(hook.forbiddenCommand("gh api -X PUT repos/o/r/pulls/1/merge", root)).toMatch(/gh api/);
    expect(hook.forbiddenCommand("gh run rerun 123456", root)).toMatch(/GitHub Actions/);
    expect(hook.forbiddenCommand("gh --repo owner/store-os run rerun 123456", root)).toMatch(/GitHub Actions/);
    expect(hook.forbiddenCommand("gh run --repo owner/store-os rerun 123456", root)).toMatch(/GitHub Actions/);
    expect(hook.forbiddenCommand("gh pr review 1 --approve", root)).toMatch(/aprobar/);
    expect(hook.forbiddenCommand("vercel deploy --target=production", root)).toMatch(/deploys/);
    expect(hook.forbiddenCommand("node scripts/backfill-public-product-store-ids.cjs --env prod --store one", root)).toMatch(/producción/);
    expect(hook.forbiddenCommand("firebase firestore:delete --project store-os-f7cf8", root)).toMatch(/producción/);
    expect(hook.forbiddenCommand("node scripts/backfill.cjs --apply", root)).toMatch(/producción/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__codex_apps__github_update_ref",
      tool_input: { branch_name: "main", sha: "abc" } })).toMatch(/main/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__codex_apps__github_add_review_to_pr",
      tool_input: { pr_number: 1, action: "APPROVE" } })).toMatch(/reviews|aprobar/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__github__rerun_workflow",
      tool_input: { run_id: 1 } })).toMatch(/GitHub Actions/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__actions__rerun_workflow",
      tool_input: { run_id: 1 } })).toMatch(/GitHub Actions/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "apply_patch",
      tool_input: { command: "*** Update File: .delivery/runs/bootstrap/history.json" } })).toMatch(/sólo puede escribirla/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "Bash",
      tool_input: { command: "rm .delivery/runs/bootstrap/history.json" } })).toMatch(/sólo puede escribirla/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "Bash",
      tool_input: { command: "printf '%s' '{}' | dd of=.delivery/runs/bootstrap/history.json" } })).toMatch(/sólo puede escribirla/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "Bash",
      tool_input: { command: "find .delivery/runs/bootstrap -name history.json -delete" } })).toMatch(/sólo puede escribirla/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "Bash",
      tool_input: { command: "node scripts/delivery-hook.cjs" } })).toMatch(/sólo puede escribirla/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__codex_apps__github_create_file",
      tool_input: { path: "bypass.txt", content: "x", branch: "main" } })).toMatch(/directamente/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__codex_apps__github_update_file",
      tool_input: { path: "bypass.txt", content: "x" } })).toMatch(/directamente/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__github__push_files",
      tool_input: { branch: "main", files: [{ path: "bypass.txt", content: "x" }] } })).toMatch(/directamente/);
  });

  it("exige draft al crear PR", () => {
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "Bash",
      tool_input: { command: "gh pr create --title change --body body" } })).toMatch(/--draft/);
    expect(hook.handle({ hook_event_name: "PreToolUse", cwd: root, tool_name: "mcp__github__create_pull_request",
      tool_input: { title: "change", draft: false } })).toMatch(/ready|draft/);
    const manifest = { kind: "code", id: "one", specPath: "docs/one.md", sha: "abc123", commands: ["npm run test"] };
    expect(hook.missingManifest("Delivery-ID: one\ndocs/one.md\nabc123\nnpm run test", manifest)).toEqual([]);
    expect(hook.missingManifest("Delivery-ID: one", manifest)).toContain("docs/one.md");
    expect(hook.missingManifest("sin marcador", { kind: "spec", id: "one" })).toContain("Delivery-ID: one");
    const bootstrap = { ...manifest, kind: "bootstrap", baseSha: "base123" };
    expect(hook.missingManifest("Delivery-ID: one\ndocs/one.md\nabc123\nnpm run test", bootstrap)).toContain("Bootstrap-Base: base123");
    expect(hook.option("gh pr create --base release --head=attacker/work", "base")).toBe("release");
    expect(hook.option("gh pr create --base release --head=attacker/work", "head")).toBe("attacker/work");
  });

  it("usa exit code 2 para rechazar una acción", () => {
    const result = spawnSync(process.execPath, [join(root, "scripts", "delivery-hook.cjs")], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: root,
        tool_name: "Bash",
        tool_input: { command: "git push origin main" },
      }),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/main/);
  });
});
