// Contract test for the software-delivery workflow script.
//
// The workflow runs in the Workflow tool's Bun sandbox, NOT under vitest, so we
// cannot simply `require()` it (its body is top-level with `return` statements
// and references the global `args`/`agent`/`phase`). Instead this test loads the
// REAL file as text, strips the `export const meta` block, wraps the body in an
// `AsyncFunction` (the same shape the runtime uses), and runs it with stubbed
// `agent`/`phase`. This exercises the actual file — so a stray orphan brace, a
// missing hard-fail, or a silent-default objective will fail this test.
//
// Supreme contract under test:
//   - the file parses (no residual structural damage from edits);
//   - missing/malformed args.objective => { status: "FAILED" }, no agent call;
//   - a valid objective reaches the first agent intact;
//   - distinct objectives => distinct runId.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// The workflow body uses top-level `await` and `return`, which are only valid
// inside an async function body (or a module top level). The Workflow runtime
// treats the file as an async function body, so we must too: use the AsyncFunction
// constructor (Function rejects `await`/top-level `return`).
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...params: string[]
) => (...args: unknown[]) => Promise<unknown>;

const WORKFLOW_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  ".claude",
  "workflows",
  "software-delivery.js"
);

/** Load the workflow file, strip `export const meta = {...};`, return the body. */
function loadWorkflowBody(): string {
  const src = fs.readFileSync(WORKFLOW_PATH, "utf8");
  // Remove the `export const meta = {...};` block (top of file). Match the
  // specific declaration this file uses; balanced-brace removal not needed
  // because meta is a flat object literal closed by `};`.
  const stripped = src.replace(/export\s+const\s+meta\s*=\s*\{[\s\S]*?\n\};\s*\n/, "");
  if (stripped === src) {
    throw new Error("Could not find/strip `export const meta = {...};` — file shape changed.");
  }
  return stripped;
}

interface RunResult {
  runId?: string;
  ok?: boolean;
  status?: string;
  reason?: string;
  [k: string]: unknown;
}

/**
 * Run the workflow body with a stubbed agent. The stub records the prompts it
 * receives and returns a BLOCKED result so the FSM stops after the first state
 * (we are testing the args contract + first-agent handoff, not the full FSM).
 */
async function runWorkflow(
  argsValue: unknown,
  workflowBody: string
): Promise<{ result: RunResult; prompts: string[] }> {
  const capturedPrompts: string[] = [];
  const agentStub = async (prompt: string): Promise<string> => {
    capturedPrompts.push(prompt);
    // BLOCKED halts the FSM after the first state (INTAKE).
    return JSON.stringify({
      agent: "stub",
      state: "INTAKE",
      status: "BLOCKED",
      summary: "Smoke test — halted by stub.",
    });
  };
  const phaseStub = (): void => {};

  // Reproduce the runtime contract: args/agent/phase are provided to the body.
  // AsyncFunction parameter names become in-scope identifiers inside the body.
  const fn = new AsyncFunction("args", "agent", "phase", workflowBody) as (
    args: unknown,
    agent: typeof agentStub,
    phase: typeof phaseStub
  ) => Promise<RunResult>;

  // Let exceptions propagate: a workflow that throws (e.g. on malformed args)
  // is a BUG and the test must fail loudly, not be hidden in a returned field.
  const result = await fn(argsValue, agentStub, phaseStub);
  return { result, prompts: capturedPrompts };
}

describe("software-delivery workflow contract", () => {
  // Build the AsyncFunction once; if the file is structurally broken, this
  // throws synchronously and EVERY test below fails with a clear cause.
  let workflowBody: string;
  try {
    workflowBody = loadWorkflowBody();
    // Probe-parse: an orphan brace or unindented return will throw here.
    // AsyncFunction because the body uses top-level `await`.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new AsyncFunction("args", "agent", "phase", workflowBody);
  } catch (e) {
    workflowBody = "";
    it("the workflow file parses (no residual structural damage)", () => {
      throw new Error(`workflow body failed to parse: ${(e as Error).message}`);
    });
    return;
  }

  it("the workflow file parses (no residual structural damage)", () => {
    // Reaching here means the AsyncFunction constructor succeeded above.
    expect(workflowBody.length).toBeGreaterThan(0);
  });

  it("returns FAILED for undefined args (no agent call)", async () => {
    const { result, prompts } = await runWorkflow(undefined, workflowBody);
    expect(result.status).toBe("FAILED");
    expect(prompts).toHaveLength(0);
  });

  it("returns FAILED for invalid JSON string args", async () => {
    const { result, prompts } = await runWorkflow("{not valid json", workflowBody);
    expect(result.status).toBe("FAILED");
    expect(prompts).toHaveLength(0);
  });

  it("returns FAILED for a JSON string with no objective", async () => {
    const { result, prompts } = await runWorkflow(JSON.stringify({}), workflowBody);
    expect(result.status).toBe("FAILED");
    expect(prompts).toHaveLength(0);
  });

  it("returns FAILED for args='null' / '42' (valid JSON, non-object)", async () => {
    // JSON.parse("null") -> null, JSON.parse("42") -> 42. Without normalization
    // these bypass the guard and throw TypeError on _args.objective. The parser
    // MUST coerce any non-object to {} so the FAILED return stays controlled.
    for (const bad of ['"null"', '"42"', '"true"', '"[1,2]"']) {
      const argsString = JSON.parse(bad); // the runtime delivers the parsed-or-string value
      const { result, prompts } = await runWorkflow(argsString, workflowBody);
      expect(result.status).toBe("FAILED");
      expect(prompts).toHaveLength(0);
    }
  });

  it("a valid objective (JSON string) reaches the first agent intact", async () => {
    const objective = "Smoke objective — reach INTAKE intact";
    const { prompts } = await runWorkflow(JSON.stringify({ objective }), workflowBody);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(`Objective: ${objective}`);
  });

  it("distinct objectives produce distinct runIds", async () => {
    const a = await runWorkflow(
      JSON.stringify({ objective: "Objective A — distinct runId" }),
      workflowBody
    );
    const b = await runWorkflow(
      JSON.stringify({ objective: "Objective B — distinct runId" }),
      workflowBody
    );
    // Both reach INTAKE and get BLOCKED; their runIds come from fnv1a(objective).
    // BLOCKED returns { runId, ... } at the abort site.
    expect(a.result.runId).toBeTruthy();
    expect(b.result.runId).toBeTruthy();
    expect(a.result.runId).not.toBe(b.result.runId);
  });

  it("accepts a plain object args (non-string tolerance) with an objective", async () => {
    // The parser accepts objects too (typeof args === "string" ? JSON.parse : args).
    const objective = "Plain-object objective — tolerated by the parser";
    const { prompts } = await runWorkflow({ objective }, workflowBody);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(`Objective: ${objective}`);
  });
});
