import { OLIVIA_SLUG } from "../../design-system";
import type { Product } from "../../types";

/** Apply creation defaults only to the canonical Olivia storefront. */
export function productCreationDefaults(product: Product, storeSlug: string): Product {
  if (storeSlug !== OLIVIA_SLUG) return product;
  return {
    ...product,
    status: "published",
    canInquire: true,
    isNew: false,
    isFeatured: false,
    finish: "Acero inoxidable",
  };
}
