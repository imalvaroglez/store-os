import type { Product, Order, Customer, Category, Supplier, Purchase } from "../types";

// Store-isolation selectors. Everything read from state is filtered by storeId here.
// Centralizing it guarantees no screen can leak another store's data.

export function productsForStore(products: Product[], storeId: string): Product[] {
  return products.filter((p) => p.storeId === storeId);
}

export function categoriesForStore(categories: Category[], storeId: string): Category[] {
  return categories.filter((c) => c.storeId === storeId);
}

export function suppliersForStore(suppliers: Supplier[], storeId: string): Supplier[] {
  return suppliers.filter((s) => s.storeId === storeId);
}

export function purchasesForStore(purchases: Purchase[], storeId: string): Purchase[] {
  return purchases.filter((p) => p.storeId === storeId);
}

/** Active categories only, in admin order. */
export function activeCategoriesForStore(categories: Category[], storeId: string): Category[] {
  return categoriesForStore(categories, storeId)
    .filter((c) => c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Public products for a store: published (not draft/archived). The legacy
 * `isPublic` flag is honored only for not-yet-migrated products; once a product
 * has `status`, that is the source of truth.
 */
export function publicProductsForStore(
  products: Product[],
  storeId: string
): Product[] {
  return products.filter((p) => {
    if (p.storeId !== storeId) return false;
    if (p.status) return p.status === "published";
    return p.isPublic;
  });
}

export function ordersForStore(orders: Order[], storeId: string): Order[] {
  return orders.filter((o) => o.storeId === storeId);
}

export function customersForStore(customers: Customer[], storeId: string): Customer[] {
  return customers.filter((c) => c.storeId === storeId);
}

export function lowStockProducts(products: Product[], storeId: string): Product[] {
  return products.filter(
    (p) =>
      p.storeId === storeId &&
      typeof p.quantityOnHand === "number" &&
      typeof p.lowStockAt === "number" &&
      p.quantityOnHand <= p.lowStockAt
  );
}

