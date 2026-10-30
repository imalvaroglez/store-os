import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface BackfillResult {
  status: "noop" | "ready";
  candidates: string[];
  committed: boolean;
}

interface BackfillModule {
  executeBackfill(input: {
    db: unknown;
    FieldPath: { documentId(): string };
    projectId: string;
    store: string;
    apply: boolean;
    log: () => void;
  }): Promise<BackfillResult>;
  isValidStoreId(store: unknown): boolean;
}

interface FakeState {
  publicReads: number;
  batchCalls: number;
  commits: number;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
}

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/backfill-public-product-store-ids.cjs");
const require = createRequire(import.meta.url);
const { executeBackfill, isValidStoreId } = require(SCRIPT_PATH) as BackfillModule;
const STORE = "store_olivia";
const FIELD_PATH = { documentId: () => "__name__" };

function createFakeFirestore(
  controlStore: Record<string, unknown> | null,
  docs: Array<{ id: string; data: Record<string, unknown> }>
) {
  const state: FakeState = { publicReads: 0, batchCalls: 0, commits: 0, updates: [] };
  const fakeDocs = docs.map(({ id, data }) => ({ id, data: () => data, ref: { id } }));
  const publicQuery = {
    where: () => publicQuery,
    get: async () => {
      state.publicReads += 1;
      return { size: fakeDocs.length, docs: fakeDocs };
    },
  };
  const db = {
    collection(name: string) {
      if (name === "adminStores") {
        return {
          doc: () => ({
            get: async () => ({
              exists: controlStore !== null,
              data: () => controlStore,
            }),
          }),
        };
      }
      if (name === "publicProducts") return publicQuery;
      throw new Error(`Unexpected collection: ${name}`);
    },
    batch() {
      state.batchCalls += 1;
      return {
        update(ref: { id: string }, data: Record<string, unknown>) {
          state.updates.push({ id: ref.id, data });
        },
        async commit() {
          state.commits += 1;
        },
      };
    },
  };
  return { db, state };
}

function execute(
  fake: ReturnType<typeof createFakeFirestore>,
  apply: boolean
): Promise<BackfillResult> {
  return executeBackfill({
    db: fake.db,
    FieldPath: FIELD_PATH,
    projectId: "store-os-dev",
    store: STORE,
    apply,
    log: () => {},
  });
}

describe("publicProducts storeId backfill executor", () => {
  it.each([
    ["is missing", null],
    ["has a different storeId", { storeId: "store_other" }],
  ])("aborts before reading publicProducts when adminStores %s", async (_label, controlStore) => {
    const fake = createFakeFirestore(
      controlStore,
      [{ id: `${STORE}__legacy`, data: {} }]
    );

    await expect(execute(fake, true)).rejects.toThrow(/adminStores\/store_olivia/);
    expect(fake.state.publicReads).toBe(0);
    expect(fake.state.batchCalls).toBe(0);
    expect(fake.state.commits).toBe(0);
  });

  it("does not create a batch for a no-op", async () => {
    const fake = createFakeFirestore(
      { storeId: STORE },
      [{ id: `${STORE}__ready`, data: { storeId: STORE } }]
    );

    await expect(execute(fake, true)).resolves.toMatchObject({
      status: "noop",
      candidates: [],
      committed: false,
    });
    expect(fake.state.batchCalls).toBe(0);
  });

  it("does not create a batch during dry-run", async () => {
    const fake = createFakeFirestore(
      { storeId: STORE },
      [{ id: `${STORE}__legacy`, data: { storeSlug: "olivia" } }]
    );

    await expect(execute(fake, false)).resolves.toMatchObject({
      status: "ready",
      candidates: [`${STORE}__legacy`],
      committed: false,
    });
    expect(fake.state.batchCalls).toBe(0);
    expect(fake.state.commits).toBe(0);
  });

  it("aborts an anomalous candidate before creating a batch", async () => {
    const fake = createFakeFirestore(
      { storeId: STORE },
      [{ id: "store_other__legacy", data: {} }]
    );

    await expect(execute(fake, true)).rejects.toThrow("storeId derivado");
    expect(fake.state.batchCalls).toBe(0);
    expect(fake.state.commits).toBe(0);
  });

  it("commits one partial update only when apply is true", async () => {
    const fake = createFakeFirestore(
      { storeId: STORE },
      [{ id: `${STORE}__legacy`, data: { storeSlug: "olivia" } }]
    );

    await expect(execute(fake, true)).resolves.toMatchObject({
      status: "ready",
      committed: true,
    });
    expect(fake.state.batchCalls).toBe(1);
    expect(fake.state.commits).toBe(1);
    expect(fake.state.updates).toEqual([
      { id: `${STORE}__legacy`, data: { storeId: STORE } },
    ]);
  });
});

describe("publicProducts storeId backfill CLI", () => {
  it.each([
    ["empty --env=", ["--test", "--env="]],
    ["empty --store=", ["--test", "--store="]],
    ["missing --env value", ["--test", "--env"]],
    ["missing --store value", ["--test", "--store"]],
    ["empty separate --env value", ["--test", "--env", ""]],
    ["empty separate --store value", ["--test", "--store", ""]],
  ])("rejects --test combined with %s", (_label, args) => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--test es exclusivo");
  });

  it.each([
    ["all required flags", []],
    ["--store", ["--env=dev"]],
    ["--env", [`--store=${STORE}`]],
    ["the --env value", ["--env"]],
    ["the --store value", ["--store"]],
  ])("rejects a run missing %s", (_label, args) => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Faltan --env y/o --store");
  });

  it("accepts store ids generated by uid('store')", () => {
    expect(isValidStoreId("store_a1b2c3d4-1234-4abc-8def-1234567890ab")).toBe(true);
    expect(isValidStoreId("store_olivia")).toBe(true);
    expect(isValidStoreId("store_-broken")).toBe(false);
  });
});
