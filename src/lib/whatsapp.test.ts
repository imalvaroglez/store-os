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

// Storefront messages: immutable context (name, SKU, URL, intent) is always
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
  sku: "OLI-001",
  productSlug: "anillo-de-plata",
};

describe("createStorefrontBuyUrl", () => {
  it("includes the editable intro, name, SKU, and product URL", () => {
    const url = createStorefrontBuyUrl(sfStore, "olivia", sfProduct);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, me interesa esta pieza:");
    expect(text).toContain("Anillo de plata");
    expect(text).toContain("Clave: OLI-001");
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

  it("still includes name + URL even without a SKU", () => {
    const url = createStorefrontBuyUrl(sfStore, "olivia", { name: "Collar", sku: "OLV-001", productSlug: "collar" });
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Collar");
    expect(text).toContain("/catalogo/olivia/producto/collar");
    expect(text).not.toContain("SKU");
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
    { name: "Anillo Blossom", sku: "AAN1385", qty: 2 },
    { name: "Aretes Luna", sku: "OLI-002", qty: 1, inquire: true },
  ];

  it("arma un solo mensaje con intro, Pedido:, las líneas y el link al catálogo", () => {
    const url = buildCartOrderUrl(sfStore, "olivia", cartLines);
    expect(url).toContain("wa.me/5215512345678");
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Hola, me interesa esta pieza:"); // intro editable como prefijo
    expect(text).toContain("Pedido:");
    expect(text).toContain("• 2× Anillo Blossom (AAN1385)");
    expect(text).toContain("• 1× Aretes Luna (OLI-002) — sobre pedido");
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
});
