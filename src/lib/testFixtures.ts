// Minimal three-store fixture for unit tests. Replaces the deleted demo seed
// (src/lib/seed.ts): only the entities the tests actually assert on, built with
// plain literals so no provider/factory import is needed. The full Olivia
// fixture for the DEV backend lives in scripts/seed-dev.cjs.
import type { AppState, Customer, Order, Product, Store } from "../types";

const NOW = "2026-08-17T00:00:00.000Z";

const oliviaId = "store_olivia";
const santiId = "store_santi";
const joyeriaId = "store_joyeria";

const store = (id: string, name: string, slug: string, type: Store["type"]): Store => ({
  id, name, slug, type, whatsappPhone: "5215512345678", createdAt: NOW, updatedAt: NOW,
});

const product = (id: string, storeId: string, name: string, isPublic: boolean): Product =>
  ({ id, storeId, name, category: "other", isPublic, status: "published", createdAt: NOW, updatedAt: NOW }) as Product;

const order = (id: string, storeId: string, productName: string, status: Order["status"]): Order =>
  ({ id, storeId, customerId: "", productName, quantity: 1, price: 100, deposit: 0, status, createdAt: NOW, updatedAt: NOW }) as Order;

/** Olivia active, Santi on-demand, Joyería inventory — the isolation scenarios tests rely on. */
export function fixtureState(): AppState {
  return {
    stores: [
      store(oliviaId, "Olivia", "olivia", "inventory_tiered"),
      store(santiId, "Santi", "santi", "on_demand"),
      store(joyeriaId, "Joyería", "joyeria", "inventory_tiered"),
    ],
    activeStoreId: oliviaId,
    products: [
      product("prod_olivia_1", oliviaId, "Anillo de plata 925", true),
      product("prod_santi_1", santiId, "Perfume Baccarat Rouge 540", true),
      product("prod_joyeria_1", joyeriaId, "Aretes de oro", true),
      // Private: the selector prefers status over the legacy isPublic flag, so
      // a genuinely-private fixture needs status "draft" (isPublic false alone
      // is not enough when status is set).
      { ...product("prod_joyeria_2", joyeriaId, "Anillo grabado (privado)", false), status: "draft", privateNotes: "grabado encargado" },
    ],
    categories: [],
    suppliers: [],
    purchases: [],
    customers: [
      { id: "cust_joyeria_1", storeId: joyeriaId, name: "Cliente Joyería", createdAt: NOW, updatedAt: NOW } as Customer,
    ],
    orders: [
      order("order_olivia_1", oliviaId, "Anillo de plata 925", "delivered"),
      order("order_santi_1", santiId, "Perfume Baccarat Rouge 540", "confirmed"),
    ],
  };
}
