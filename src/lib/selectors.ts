import type { Product, Order, Customer } from "../types";

// Store-isolation selectors. Everything read from state is filtered by storeId here.
// Centralizing it guarantees no screen can leak another store's data.

export function productsForStore(products: Product[], storeId: string): Product[] {
  return products.filter((p) => p.storeId === storeId);
}

export function publicProductsForStore(
  products: Product[],
  storeId: string
): Product[] {
  return products.filter((p) => p.storeId === storeId && p.isPublic);
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
