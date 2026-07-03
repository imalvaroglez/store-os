import type { AppState, Store, Product, Customer, Order } from "../types";

// Demo data: two stores so every store type is explorable on first run.
// Santi = on-demand (perfumes/sneakers). Joyería = inventory-tiered.
// Each entity is fully isolated by storeId.

export function buildSeedState(): AppState {
  const now = new Date().toISOString();
  // Deterministic ids: the cloud seed (seedCloudIfEmpty) can race on a double
  // mount (StrictMode / auth-state flicker) where two runs both see an empty
  // project and both write. Random uid() ids would then duplicate every entity.
  // Fixed ids make the second run overwrite the same docs — idempotent, no dupes.
  const santiId = "store_santi";
  const joyeriaId = "store_joyeria";

  const stores: Store[] = [
    {
      id: santiId,
      name: "Santi",
      slug: "santi",
      type: "on_demand",
      whatsappPhone: "5215512345678",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: joyeriaId,
      name: "Joyería",
      slug: "joyeria",
      type: "inventory_tiered",
      whatsappPhone: "5215587654321",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const products: Product[] = [
    // Santi — on-demand (single price)
    {
      id: "prod_santi_1",
      storeId: santiId,
      name: "Perfume Baccarat Rouge 540",
      category: "perfume",
      isPublic: true,
      publicDescription: "Perfume importado, 100% original. Bajo pedido, entrega 3-5 días.",
      cost: 1200,
      price: 2200,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod_santi_2",
      storeId: santiId,
      name: "Tenis Jordan 1 Retro",
      category: "sneakers",
      isPublic: true,
      publicDescription: "Tenis bajo pedido. Pasa tu talla.",
      cost: 2800,
      price: 4200,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod_santi_3",
      storeId: santiId,
      name: "Gorra New Era (pedido especial)",
      category: "cap",
      isPublic: false,
      privateNotes: "Solo para clientes frecuentes.",
      cost: 350,
      price: 650,
      createdAt: now,
      updatedAt: now,
    },
    // Joyería — inventory-tiered
    {
      id: "prod_joyeria_1",
      storeId: joyeriaId,
      name: "Cadena de plata 925",
      category: "jewelry",
      isPublic: true,
      publicDescription: "Cadena de plata 925, 50 cm.",
      cost: 400,
      prices: { retail: 900, wholesale: 700, reseller: 600 },
      quantityOnHand: 8,
      lowStockAt: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod_joyeria_2",
      storeId: joyeriaId,
      name: "Aretes de plata",
      category: "jewelry",
      isPublic: true,
      publicDescription: "Aretes pequeños de plata.",
      cost: 150,
      prices: { retail: 350, wholesale: 250, reseller: 200 },
      quantityOnHand: 2,
      lowStockAt: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod_joyeria_3",
      storeId: joyeriaId,
      name: "Anillo grabado (privado)",
      category: "jewelry",
      isPublic: false,
      privateNotes: "Anillo con grabado personalizado, costo variable.",
      cost: 300,
      prices: { retail: 800, wholesale: 600, reseller: 500 },
      quantityOnHand: 5,
      lowStockAt: 2,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const customers: Customer[] = [
    {
      id: "cust_santi_1",
      storeId: santiId,
      name: "María López",
      phone: "5511112222",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cust_santi_2",
      storeId: santiId,
      name: "Carlos Ruiz",
      phone: "5533334444",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cust_joyeria_1",
      storeId: joyeriaId,
      name: "Ana Torres",
      phone: "5555556666",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cust_joyeria_2",
      storeId: joyeriaId,
      name: "Emprendedora Lucero",
      phone: "5577778888",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const orders: Order[] = [
    {
      id: "order_santi_1",
      storeId: santiId,
      customerId: customers[0].id,
      productName: "Perfume Baccarat Rouge 540",
      productId: products[0].id,
      quantity: 1,
      cost: 1200,
      price: 2200,
      deposit: 1000,
      status: "confirmed",
      promisedDate: now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "order_santi_2",
      storeId: santiId,
      customerId: customers[1].id,
      productName: "Tenis Jordan 1 Retro",
      productId: products[1].id,
      quantity: 1,
      cost: 2800,
      price: 4200,
      deposit: 0,
      status: "asked",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "order_joyeria_1",
      storeId: joyeriaId,
      customerId: customers[2].id,
      productName: "Cadena de plata 925",
      productId: products[3].id,
      quantity: 1,
      cost: 400,
      price: 900,
      deposit: 900,
      status: "delivered",
      priceTier: "retail",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "order_joyeria_2",
      storeId: joyeriaId,
      customerId: customers[3].id,
      productName: "Aretes de plata",
      productId: products[4].id,
      quantity: 10,
      cost: 150,
      price: 250,
      deposit: 1000,
      status: "bought",
      priceTier: "wholesale",
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    stores,
    activeStoreId: santiId,
    products,
    customers,
    orders,
  };
}
