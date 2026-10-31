import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildAdminStore, parseArgs, planMigration, validateTarget } = require("../../../scripts/migrate-adminstores.cjs") as {
  buildAdminStore: (id: string, store: Record<string, unknown>) => { status: string; data?: Record<string, unknown>; reason?: string };
  parseArgs: (argv: string[]) => { target: string; apply: boolean };
  planMigration: (db: unknown) => Promise<{ creates: Array<{ id: string }>; skipped: Array<{ id: string }> }>;
  validateTarget: (target: string, emulatorHost?: string) => void;
};

describe("migrate-adminstores", () => {
  it("copies allow-listed control fields and neutral defaults", () => {
    expect(buildAdminStore("s1", {
      name: "Olivia", ownerUid: "u1", memberUids: ["u1"], storefront: { secret: true },
    })).toEqual({ status: "create", data: {
      storeId: "s1", name: "Olivia", ownerUid: "u1", memberUids: ["u1"],
      pendingInvites: [], retainedPrivacyRequestCount: 0,
    } });
  });

  it("skips stores without valid owner membership instead of guessing", () => {
    expect(buildAdminStore("s1", { name: "Olivia" })).toMatchObject({ status: "skip" });
    expect(buildAdminStore("s2", { ownerUid: "u1", memberUids: [] })).toMatchObject({ status: "skip" });
    expect(buildAdminStore("s3", { ownerUid: "u1", memberUids: ["u2"] })).toMatchObject({ status: "skip" });
  });

  it("requires an explicit target and parses apply", () => {
    expect(() => parseArgs([])).toThrow(/exactamente una opción/);
    expect(parseArgs(["--emulator", "--apply"])).toEqual({ target: "emulator", apply: true });
    expect(() => parseArgs(["--emulator", "--prod"])).toThrow(/exactamente una opción/);
  });

  it("refuses a production target while the Firestore emulator is configured", () => {
    expect(() => validateTarget("prod", "127.0.0.1:8080")).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(() => validateTarget("emulator", "127.0.0.1:9099")).toThrow(/Host de emulador inesperado/);
    expect(() => validateTarget("emulator", "127.0.0.1:8080")).not.toThrow();
  });

  it("plans missing docs only and never schedules overwrites", async () => {
    const collections: Record<string, Array<{ id: string; data: () => Record<string, unknown> }>> = {
      stores: [
        { id: "missing", data: () => ({ ownerUid: "u1", memberUids: ["u1"] }) },
        { id: "existing", data: () => ({ ownerUid: "u2", memberUids: ["u2"] }) },
        { id: "incomplete", data: () => ({}) },
      ],
      adminStores: [{ id: "existing", data: () => ({ ownerUid: "authoritative", memberUids: ["u3"] }) }],
    };
    const db = { collection: (name: string) => ({ get: async () => ({ docs: collections[name] }) }) };
    const plan = await planMigration(db);
    expect(plan.creates.map(({ id }) => id)).toEqual(["missing"]);
    expect(plan.skipped.map(({ id }) => id)).toEqual(["incomplete"]);
  });
});
