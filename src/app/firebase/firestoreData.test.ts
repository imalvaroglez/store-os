import { describe, it, expect } from "vitest";
import { projectPublicProduct, projectPublicStore, SlugTakenError } from "./firestoreData";
import type { Product, Store } from "../../types";

// Unit tests for the public-projection builders. These guarantee that the docs
// anonymous visitors read physically carry NO private fields — the security
// model is "leak-proof by construction", and these tests lock that invariant.
// (The Firestore read path is covered by e2e/public-catalog.spec.ts.)

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    storeId: "s1",
    name: "Perfume",
    category: "perfume",
    isPublic: true,
    ...overrides,
  } as Product;
}

const store: Store = {
  id: "s1",
  name: "Santi",
  slug: "santi",
  type: "on_demand",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ownerUid: "uid-secret",
  memberUids: ["uid-secret"],
};

describe("projectPublicStore", () => {
  it("exposes only name/slug/type/whatsapp — never membership fields", () => {
    const projected = projectPublicStore(store);
    expect(projected).toEqual({
      name: "Santi",
      slug: "santi",
      type: "on_demand",
      whatsappPhone: null,
    });
    // Membership fields must be physically absent.
    expect("ownerUid" in projected).toBe(false);
    expect("memberUids" in projected).toBe(false);
    expect("pendingInvites" in projected).toBe(false);
  });
});

describe("projectPublicProduct", () => {
  it("on-demand: copies price, omits cost/notes/inventory", () => {
    const projected = projectPublicProduct(
      baseProduct({ price: 1500, cost: 900, privateNotes: "secreto", quantityOnHand: 5 }),
      "santi"
    );
    expect(projected.price).toBe(1500);
    expect("cost" in projected).toBe(false);
    expect("privateNotes" in projected).toBe(false);
    expect("quantityOnHand" in projected).toBe(false);
    expect(projected.storeSlug).toBe("santi");
  });

  it("inventory-tiered: copies only prices.retail, never wholesale/reseller", () => {
    const projected = projectPublicProduct(
      baseProduct({
        isPublic: true,
        prices: { retail: 2000, wholesale: 1500, reseller: 1700 },
        cost: 800,
      }),
      "joyeria"
    );
    const prices = projected.prices as Record<string, unknown> | undefined;
    expect(prices).toEqual({ retail: 2000 });
    expect(prices && "wholesale" in prices).toBe(false);
    expect(prices && "reseller" in prices).toBe(false);
    expect("cost" in projected).toBe(false);
  });

  it("omits price entirely when undefined", () => {
    const projected = projectPublicProduct(baseProduct({ price: undefined }), "santi");
    expect("price" in projected).toBe(false);
  });
});

describe("SlugTakenError", () => {
  it("carries the colliding slug and a Spanish message", () => {
    const err = new SlugTakenError("santi");
    expect(err.slug).toBe("santi");
    expect(err.message).toContain("santi");
  });
});
