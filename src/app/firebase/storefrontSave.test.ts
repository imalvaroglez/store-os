import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Storefront } from "../../types";

const mocks = vi.hoisted(() => ({
  batch: { set: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) },
  doc: vi.fn((_: unknown, collection: string, id: string) => ({ collection, id })),
  writeBatch: vi.fn(),
}));

vi.mock("./config", () => ({ getFirebase: () => ({ db: { name: "test-db" } }) }));
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<object>(),
  doc: mocks.doc,
  writeBatch: mocks.writeBatch,
}));

import { saveStorefrontBatch } from "./firestoreData";

describe("saveStorefrontBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batch.commit.mockResolvedValue(undefined);
    mocks.writeBatch.mockReturnValue(mocks.batch);
  });

  it("writes the private, control and public storefront docs in one batch", async () => {
    await saveStorefrontBatch({ id: "s1", slug: "olivia" }, { hero: { body: "Texto", heading: undefined } } as Storefront, "2026-10-29T00:00:00.000Z");

    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.batch.set).toHaveBeenCalledTimes(3);
    expect(mocks.batch.set).toHaveBeenNthCalledWith(1, { collection: "stores", id: "s1" }, { storefront: { hero: { body: "Texto" } }, updatedAt: "2026-10-29T00:00:00.000Z" }, { merge: true });
    expect(mocks.batch.set).toHaveBeenNthCalledWith(2, { collection: "adminStores", id: "s1" }, { storeId: "s1" }, { merge: true });
    expect(mocks.batch.set).toHaveBeenNthCalledWith(3, { collection: "publicStores", id: "olivia" }, { storeId: "s1", storefront: { hero: { body: "Texto" } } }, { merge: true });
    expect(mocks.batch.commit).toHaveBeenCalledTimes(1);
  });
});
