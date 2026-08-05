import type { AppState, Store, Product, Customer, Order, Category, Storefront } from "../types";

// Demo data for first run. Olivia is the primary, ready-to-operate store (the
// north-star: a jewelry shop Fer runs end-to-end) — seeded with storefront
// content + initial categories so it's presentable on /catalogo/olivia out of
// the box. Santi (on-demand) and Joyería (inventory-tiered) stay as secondary
// demos so both store types remain explorable. Each entity is isolated by storeId.

export function buildSeedState(): AppState {
  const now = new Date().toISOString();
  // Deterministic ids: the cloud seed (seedCloudIfEmpty) can race on a double
  // mount (StrictMode / auth-state flicker) where two runs both see an empty
  // project and both write. Random uid() ids would then duplicate every entity.
  // Fixed ids make the second run overwrite the same docs — idempotent, no dupes.
  const oliviaId = "store_olivia";
  const santiId = "store_santi";
  const joyeriaId = "store_joyeria";

  // Olivia's storefront content — clearly provisional copy Fer replaces in
  // Ajustes → Editar sitio público.
  const oliviaStorefront: Storefront = {
    hero: {
      heading: "Olivia",
      body: "Joyería hecha a mano, piezas únicas para cada ocasión.",
    },
    benefits: ["Envíos a todo el país", "Plata 925 y materiales de calidad", "Cada pieza es única"],
    story: {
      heading: "Nuestra historia",
      body: "Cuenta aquí la historia de Olivia. (Texto provisional — edítalo en Sitio público.)",
    },
    resale: {
      heading: "Vende con Olivia",
      body: "¿Quieres formar parte del programa de reventa? Escríbeme por WhatsApp.",
    },
    faq: [
      { q: "¿Hacen envíos?", a: "Sí, a todo el país. (Texto provisional.)" },
      { q: "¿Cómo cuido mis piezas?", a: "Evita el contacto con agua y perfumes. (Provisional.)" },
    ],
    shipping: "Envíos a todo el país. (Provisional.)",
    payments: ["Transferencia", "Efectivo"],
    policies: "Devoluciones dentro de 7 días. (Provisional.)",
    hours: "Lunes a sábado, 10:00–18:00. (Provisional.)",
    whatsappBuyIntro: "Hola, me interesa esta pieza:",
    whatsappResaleIntro: "Hola, quiero información sobre el programa de reventa.",
    showSoldOut: true,
    seo: {
      title: "Olivia — Joyería hecha a mano",
      description: "Joyería hecha a mano, piezas únicas para cada ocasión.",
    },
  };

  const stores: Store[] = [
    {
      id: oliviaId,
      name: "Olivia",
      slug: "olivia",
      type: "inventory_tiered",
      whatsappPhone: "5215512345678",
      skuPrefix: "OLIV",
      storefront: oliviaStorefront,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: santiId,
      name: "Santi",
      slug: "santi",
      type: "on_demand",
      whatsappPhone: "5215512345678",
      skuPrefix: "SANT",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: joyeriaId,
      name: "Joyería",
      slug: "joyeria",
      type: "inventory_tiered",
      whatsappPhone: "5215587654321",
      skuPrefix: "JOYE",
      createdAt: now,
      updatedAt: now,
    },
  ];

  // Olivia's categories are explicit (named, ordered, active) so the storefront
  // shows real groupings, not the generic migration labels. Products carry
  // categoryIds so migrateCatalog won't synthesize duplicate categories for them.
  const oliviaCategories: Category[] = [
    { id: `${oliviaId}__anillos`, storeId: oliviaId, name: "Anillos", slug: "anillos", sortOrder: 0, active: true, createdAt: now, updatedAt: now },
    { id: `${oliviaId}__collares`, storeId: oliviaId, name: "Collares", slug: "collares", sortOrder: 1, active: true, createdAt: now, updatedAt: now },
    { id: `${oliviaId}__pulseras`, storeId: oliviaId, name: "Pulseras", slug: "pulseras", sortOrder: 2, active: true, createdAt: now, updatedAt: now },
  ];

  const products: Product[] = [
    // Olivia — inventory-tiered jewelry (provisional pieces)
    {
      id: "prod_olivia_1",
      storeId: oliviaId,
      name: "Anillo de plata 925",
      sku: "OLIV-ANILLO-DE-PLATA-925",
      category: "jewelry",
      categoryIds: [`${oliviaId}__anillos`],
      isPublic: true,
      publicDescription: "Anillo de plata 925, ajustable. (Pieza provisional.)",
      material: "Plata 925",
      finish: "Pulido",
      dimensions: "Ajustable",
      care: "Evita el agua y perfumes.",
      status: "published",
      availability: "available",
      isFeatured: true,
      isNew: true,
      canInquire: true,
      cost: 300,
      prices: { retail: 800, wholesale: 600, reseller: 500 },
      quantityOnHand: 5,
      lowStockAt: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod_olivia_2",
      storeId: oliviaId,
      name: "Collar de plata con dije",
      sku: "OLIV-COLLAR-DE-PLATA-CON-DIJE",
      category: "jewelry",
      categoryIds: [`${oliviaId}__collares`],
      isPublic: true,
      publicDescription: "Collar de plata 925, 45 cm. (Pieza provisional.)",
      material: "Plata 925",
      finish: "Pulido",
      dimensions: "45 cm",
      care: "Evita el agua y perfumes.",
      status: "published",
      availability: "low_stock",
      isFeatured: false,
      isNew: true,
      canInquire: true,
      cost: 400,
      prices: { retail: 950, wholesale: 700, reseller: 600 },
      quantityOnHand: 2,
      lowStockAt: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prod_olivia_3",
      storeId: oliviaId,
      name: "Anillo grabado (privado)",
      sku: "OLIV-ANILLO-GRABADO",
      category: "jewelry",
      categoryIds: [`${oliviaId}__anillos`],
      isPublic: false,
      privateNotes: "Anillo con grabado personalizado, costo variable.",
      status: "draft",
      cost: 350,
      prices: { retail: 900, wholesale: 650, reseller: 550 },
      quantityOnHand: 4,
      lowStockAt: 2,
      createdAt: now,
      updatedAt: now,
    },
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
      id: "cust_olivia_1",
      storeId: oliviaId,
      name: "Ana Torres",
      phone: "5555556666",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cust_olivia_2",
      storeId: oliviaId,
      name: "Emprendedora Lucero",
      phone: "5577778888",
      createdAt: now,
      updatedAt: now,
    },
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
      id: "order_olivia_1",
      storeId: oliviaId,
      customerId: customers[0].id,
      productName: "Anillo de plata 925",
      productId: products[0].id,
      quantity: 1,
      cost: 300,
      price: 800,
      deposit: 800,
      status: "delivered",
      priceTier: "retail",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "order_santi_1",
      storeId: santiId,
      customerId: customers[2].id,
      productName: "Perfume Baccarat Rouge 540",
      productId: products[3].id,
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
      customerId: customers[3].id,
      productName: "Tenis Jordan 1 Retro",
      productId: products[4].id,
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
      customerId: customers[4].id,
      productName: "Cadena de plata 925",
      productId: products[6].id,
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
      customerId: customers[5].id,
      productName: "Aretes de plata",
      productId: products[7].id,
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
    // Olivia is the active store on first run — she's the one being operated.
    activeStoreId: oliviaId,
    products,
    categories: oliviaCategories, // Santi/Joyería categories synthesized by migrateCatalog
    suppliers: [],
    purchases: [],
    customers,
    orders,
  };
}
