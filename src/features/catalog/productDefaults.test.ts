import { describe, expect, it } from "vitest";
import { productCreationDefaults } from "./productDefaults";
import type { Product } from "../../types";

const base = {
  id: "p1", storeId: "store_olivia", name: "", category: "other" as const,
  isPublic: false, status: "draft" as const, createdAt: "now", updatedAt: "now",
} satisfies Product;

describe("productCreationDefaults", () => {
  it("sets editable Olivia creation defaults without changing identity", () => {
    const result = productCreationDefaults(base, "olivia");
    expect(result).toMatchObject({
      id: "p1", storeId: "store_olivia", status: "published", canInquire: true,
      isNew: false, isFeatured: false, material: "Acero inoxidable",
    });
    // Color/acabado starts empty: only Material carries the creation default.
    expect(result.finish).toBeUndefined();
  });

  it("leaves other stores unchanged", () => {
    expect(productCreationDefaults(base, "santi")).toBe(base);
  });

  it("preserves explicitly saved empty and false values", () => {
    const edited = { ...base, status: "draft" as const, canInquire: false, isNew: true, isFeatured: true, material: "", finish: "" };
    expect(productCreationDefaults(edited, "santi")).toEqual(edited);
  });
});
