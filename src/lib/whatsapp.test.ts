import { describe, it, expect } from "vitest";
import {
  buildCartOrderUrl,
  createWhatsAppShareCatalogUrl,
  createStorefrontBuyUrl,
  createStorefrontContactUrl,
  createStorefrontResaleUrl,
  type StorefrontWhatsAppTarget,
  type StorefrontProductRef,
  type CartOrderLine,
} from "./whatsapp";
import { cartRequestSummary } from "./pricing";
import type { Store } from "../types";
import { calculateOrderPricing } from "./pricing";

const baseStore: Store = {
  id: "s1",
  name: "Joyería Luna",
  slug: "joyeria-luna",
  type: "inventory_tiered",
  ownerUid: "u1",
  memberUids: ["u1"],
  createdAt: "",
  updatedAt: "",
};

describe("createWhatsAppShareCatalogUrl", () => {
  it("builds a wa.me link that embeds the catalog URL and store name", () => {
    const url = createWhatsAppShareCatalogUrl(baseStore, "https://os.app/catalogo/joyeria-luna");
    expect(url.startsWith("https://wa.me/")).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("Joyería Luna");
    expect(decoded).toContain("https://os.app/catalogo/joyeria-luna");
  });

  it("omits the phone when the store has no whatsapp number", () => {
    const url = createWhatsAppShareCatalogUrl(baseStore, "https://os.app/catalogo/joyeria-luna");
    // No phone → bare wa.me/?text=... (no wa.me/<digits>)
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("ignores the owner's own phone (she sends to many customers, not herself)", () => {
    const url = createWhatsAppShareCatalogUrl(
      { ...baseStore, whatsappPhone: "+52 1 55 1234 5678" },
      "https://os.app/catalogo/joyeria-luna",
    );
    // Always contact-picker mode — no phone baked into the URL.
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(url).not.toContain("5215512345678");
  });
});

// Storefront messages: immutable context (name, URL, intent) is always
// appended so Fer's editable intro can't strip identifying info.

const sfStore: StorefrontWhatsAppTarget = {
  whatsappPhone: "5215512345678",
  storefront: {
    whatsappBuyIntro: "Hola, me interesa esta pieza:",
    whatsappResaleIntro: "Hola, quiero info de reventa.",
  },
};
const sfProduct: StorefrontProductRef = {
  name: "Anillo de plata",
  productSlug: "anillo-de-plata",
};

describe("createStorefrontBuyUrl", () => {
  it("includes the editable intro, name, and product URL without internal data", () => {
    const url = createStorefrontBuyUrl(sfStore, "olivia", sfProduct);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, me interesa esta pieza:");
    expect(text).toContain("Anillo de plata");
    expect(text).not.toContain("Clave:");
    expect(text).toContain(`/catalogo/olivia/producto/anillo-de-plata`);
    expect(url).toContain("wa.me/5215512345678");
  });

  it("falls back to a default intro when Fer left it empty", () => {
    const url = createStorefrontBuyUrl(
      { whatsappPhone: "5215512345678", storefront: { whatsappBuyIntro: "" } },
      "olivia",
      sfProduct
    );
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text.startsWith("Hola, me interesa esta pieza:")).toBe(true);
  });

  it("includes name + URL without requiring a SKU", () => {
    const url = createStorefrontBuyUrl(sfStore, "olivia", { name: "Collar", productSlug: "collar" });
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Collar");
    expect(text).toContain("/catalogo/olivia/producto/collar");
    expect(text).not.toContain("Clave:");
  });
});

describe("createStorefrontContactUrl", () => {
  it("targets the store home URL with a contact intent", () => {
    const url = createStorefrontContactUrl(sfStore, "olivia");
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("/catalogo/olivia");
    expect(url).toContain("wa.me/5215512345678");
  });
});

describe("createStorefrontResaleUrl", () => {
  it("uses the editable resale intro and the store URL", () => {
    const url = createStorefrontResaleUrl(sfStore, "olivia");
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, quiero info de reventa.");
    expect(text).toContain("/catalogo/olivia");
  });

  it("falls back to a default resale intro when empty", () => {
    const url = createStorefrontResaleUrl(
      { whatsappPhone: "5215512345678", storefront: { whatsappResaleIntro: "" } },
      "olivia"
    );
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text.toLowerCase()).toContain("reventa");
  });
});

describe("buildCartOrderUrl — pedido de varias líneas", () => {
  const cartLines: CartOrderLine[] = [
    { name: "Anillo Blossom", qty: 2 },
    { name: "Aretes Luna", qty: 1, inquire: true },
  ];

  it("arma un solo mensaje con intro, Pedido:, las líneas y el link al catálogo", () => {
    const url = buildCartOrderUrl(sfStore, "olivia", cartLines);
    expect(url).toContain("wa.me/5215512345678");
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, me interesa esta pieza:"); // intro editable como prefijo
    expect(text).toContain("Pedido:");
    expect(text).toContain("• 2× Anillo Blossom");
    expect(text).toContain("• 1× Aretes Luna — sobre pedido");
    expect(text).not.toContain("AAN1385");
    expect(text).not.toContain("OLI-002");
    expect(text).toContain("/catalogo/olivia");
  });

  it("conserva el mensaje sin subtotal para tiendas legacy", () => {
    const url = buildCartOrderUrl(sfStore, "olivia", cartLines);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).not.toContain("$");
    expect(text).not.toContain("Precio aplicable");
  });

  it("incluye el resumen calculado para una tienda con niveles", () => {
    const pricing = calculateOrderPricing(
      [
        { id: "t_retail", label: "Regular", order: 0 },
        { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
        { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
      ],
      [{ qty: 12, unitPrices: { t_retail: 140, t_girly: 120, t_iconic: 90 } }]
    );
    const url = buildCartOrderUrl(sfStore, "olivia", cartLines, pricing);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Total de piezas: 12");
    expect(text).toContain("Precio aplicable: Iconic");
    expect(text).toContain("Subtotal estimado: $1,080 MXN");
    expect(text).toContain("Envío no incluido");
    expect(text).toContain("Precio y existencia por confirmar por WhatsApp");
  });

  it("usa un intro por defecto cuando la tienda no definió uno", () => {
    const url = buildCartOrderUrl(
      { whatsappPhone: "5215512345678", storefront: { whatsappBuyIntro: "" } },
      "olivia",
      cartLines
    );
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, quiero hacer un pedido:");
  });

  it("incluye el nombre de la clienta en el intro por defecto", () => {
    const url = buildCartOrderUrl(
      { whatsappPhone: "5215512345678", storefront: { whatsappBuyIntro: "" } },
      "olivia",
      cartLines,
      undefined,
      "Mar"
    );
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, soy Mar, quiero hacer un pedido:");
  });

  it("con intro editable, el nombre viaja como línea propia sin duplicarse", () => {
    const url = buildCartOrderUrl(sfStore, "olivia", cartLines, undefined, "Mar");
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, me interesa esta pieza:"); // intro editable intacto
    expect(text).toContain("Soy Mar.");
    expect(text.match(/Soy Mar/g)).toHaveLength(1);
  });

  it("un intro que menciona el nombre como saludo no suprime la línea de identidad", () => {
    // "Hola, Mar:" contiene "Mar" como substring — antes se comía el "Soy Mar."
    const url = buildCartOrderUrl(
      { whatsappPhone: "5215512345678", storefront: { whatsappBuyIntro: "Hola, Mar: qué gusto" } },
      "olivia",
      cartLines,
      undefined,
      "Mar"
    );
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Soy Mar.");
  });
});

describe("#305 mensaje WhatsApp — categorías, dos cifras y escaping", () => {
  const store = { whatsappPhone: "5215512345678" };
  const tiers = [
    { id: "t_retail", label: "Regular", order: 0 },
    { id: "t_reseller", label: "Iconic", order: 2, minAmount: 1000 },
  ];
  const request = cartRequestSummary(tiers, [
    { qty: 2, unitPrices: { t_retail: 250, t_reseller: 90 } },
    { qty: 1, unitPrices: { t_retail: 280, t_reseller: 100 } },
  ])!;

  it("agrupa por categoría con encabezados en negritas y Sin categoría", () => {
    const url = buildCartOrderUrl(store, "olivia", [
      { name: "Arracada Mimosa", qty: 2, category: "Aretes" },
      { name: "Collar Aurora", qty: 1, category: "Collares" },
      { name: "Pieza libre", qty: 1 },
    ], undefined, undefined, request);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("*ARETES*");
    expect(text).toContain("*COLLARES*");
    expect(text).toContain("*SIN CATEGORÍA*");
    expect(text).toContain("• 2× Arracada Mimosa");
    // Orden estable por categoría de inserción.
    expect(text.indexOf("*ARETES*")).toBeLessThan(text.indexOf("*COLLARES*"));
  });

  it("una sola categoría no imprime encabezado", () => {
    const url = buildCartOrderUrl(store, "olivia", [
      { name: "Arracada Mimosa", qty: 2, category: "Aretes" },
    ], undefined, undefined, request);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).not.toContain("*ARETES*");
  });

  it("dos cifras etiquetadas cuando el carrito muestra la fila Iconic (< $1,000)", () => {
    // habitual = 2×250 + 1×280 = 780 < 1000 → ambas.
    expect(request.showIdentityHint).toBe(true);
    const url = buildCartOrderUrl(store, "olivia", [
      { name: "Arracada Mimosa", qty: 2, category: "Aretes" },
      { name: "Collar Aurora", qty: 1, category: "Collares" },
    ], undefined, undefined, request);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Subtotal estimado: $780.00 MXN");
    expect(text).toContain("¿Eres Iconic? Subtotal estimado: $280.00 MXN");
    expect(text).toContain("sujetos a confirmación");
    expect(text).toContain("Envío no incluido");
  });

  it("desde $1,000 habitual el mensaje OMITE la cifra Iconic (coherencia con el carrito)", () => {
    const bigRequest = cartRequestSummary(tiers, [
      { qty: 4, unitPrices: { t_retail: 250, t_reseller: 90 } },
    ])!; // habitual $1,000 exacto
    expect(bigRequest.showIdentityHint).toBe(false);
    const url = buildCartOrderUrl(store, "olivia", [
      { name: "Arracada Mimosa", qty: 4, category: "Aretes" },
    ], undefined, undefined, bigRequest);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Subtotal estimado: $1,000.00 MXN");
    expect(text).not.toContain("Iconic");
  });

  it("cuadre exacto con el carrito (1.13.1): caso 19 piezas $140/$105/$55", () => {
    const oliviaTiers = [
      { id: "t_retail", label: "Regular", order: 0 },
      { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
      { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
    ];
    const req = cartRequestSummary(oliviaTiers, [
      { qty: 19, unitPrices: { t_retail: 140, t_girly: 105, t_iconic: 55 } },
    ])!;
    expect(req.habitualSubtotal).toBe(1995);
    const url = buildCartOrderUrl(store, "olivia", [
      { name: "Arracada Mimosa", qty: 19, category: "Aretes" },
    ], undefined, undefined, req);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Subtotal estimado: $1,995.00 MXN");
    expect(text).not.toContain("1,045"); // jamás el subtotal Iconic divergente
    expect(text).not.toContain("Iconic"); // $1,995 ≥ $1,000 → sin fila ni cifra
  });

  it("centavos reales en ambas cifras cuando el habitual los lleva (1.13.1)", () => {
    const centsRequest = cartRequestSummary(tiers, [
      { qty: 3, unitPrices: { t_retail: 260.17, t_reseller: 90.33 } },
    ])!; // habitual $780.51 < 1,000 → ambas filas
    const url = buildCartOrderUrl(store, "olivia", [
      { name: "Arracada Mimosa", qty: 3, category: "Aretes" },
    ], undefined, undefined, centsRequest);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Subtotal estimado: $780.51 MXN");
    expect(text).toContain("¿Eres Iconic? Subtotal estimado: $270.99 MXN");
  });

  it("escapa Markdown de WhatsApp en nombres de piezas y de clienta", () => {
    const url = buildCartOrderUrl(store, "olivia", [
      { name: "Collar *Brillante_1*", qty: 1 },
    ], undefined, "Ana*laís", request);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Collar \\*Brillante\\_1\\*");
    expect(text).toContain("Ana\\*laís");
    // Ningún asterisco SIN escapar fuera de los encabezados *CATEGORÍA* legítimos.
  });
});
