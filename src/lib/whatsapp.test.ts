import { describe, it, expect } from "vitest";
import { createWhatsAppShareCatalogUrl } from "./whatsapp";
import type { Store } from "../types";

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
