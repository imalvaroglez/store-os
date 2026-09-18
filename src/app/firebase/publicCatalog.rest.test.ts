import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPublicCatalog, loadPublicProduct, PublicCatalogNotFoundError, PublicProductNotFoundError } from "./publicCatalog";

// The REST loader is the public storefront's only data path; these tests pin
// the wire-format decoder (integerValue arrives as a JSON string) and the
// error mapping against fixtures shaped like real REST responses.

type RestDoc = { fields: Record<string, unknown> };

/** JS value → REST wire value (inverse of the loader's decoder). */
function toRest(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toRest) } };
  const fields: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) fields[key] = toRest(item);
  return { mapValue: { fields } };
}

function restDoc(data: Record<string, unknown>): RestDoc {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) fields[key] = toRest(value);
  return { fields };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetchByUrl(routes: Record<string, Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(routes).find((prefix) => url.includes(prefix));
    if (!match) throw new Error(`fetch inesperado: ${url}`);
    return routes[match];
  });
}

const STORE_DOC = restDoc({
  storeId: "store_olivia",
  name: "Olivia",
  type: "on_demand",
  whatsappPhone: "5215512345678",
  defaultTierId: "t_retail",
  storefront: { hero: { heading: "Joyería para hacer tuyo cada día" }, seo: {} },
  priceTiers: [{ id: "t_retail", label: "Precio", order: 1, minPieces: null }],
});

const CATALOG_DOC = restDoc({
  storeId: "store_olivia",
  categories: [{ id: "c1", name: "Aretes", slug: "aretes", sortOrder: 1 }],
  products: [
    {
      storeId: "store_olivia",
      productSlug: "anillo-luna",
      storeSlug: "olivia",
      name: "Anillo Luna",
      sku: "AR-001",
      price: null,
      prices: { t_retail: 1800, t_wholesale: 1150 },
      stockSignal: "disponible",
      isFeatured: true,
      isNew: false,
      images: [{ url: "https://example.test/a.jpg", alt: "Anillo Luna" }],
    },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadPublicCatalog (REST)", () => {
  it("decodes the wire format: integer prices as numbers, nested maps and arrays intact", async () => {
    const fetchMock = stubFetchByUrl({
      "/publicStores/olivia": jsonResponse(200, STORE_DOC),
      "/publicCatalogs/olivia": jsonResponse(200, CATALOG_DOC),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { store, catalog } = await loadPublicCatalog("olivia");

    expect(store.storeId).toBe("store_olivia");
    expect(store.name).toBe("Olivia");
    expect(store.priceTiers?.[0].minPieces).toBeNull();
    const product = catalog.products[0];
    expect(product.prices).toEqual({ t_retail: 1800, t_wholesale: 1150 });
    expect(product.prices!.t_retail).toBeTypeOf("number");
    expect(product.images![0].url).toBe("https://example.test/a.jpg");
    expect(catalog.categories[0].slug).toBe("aretes");

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.startsWith("https://firestore.googleapis.com/"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("key="))).toBe(true);
  });

  it("throws PublicCatalogNotFoundError when the store doc 404s", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchByUrl({
        "/publicStores/olivia": jsonResponse(404, {}),
        "/publicCatalogs/olivia": jsonResponse(200, CATALOG_DOC),
      })
    );
    await expect(loadPublicCatalog("olivia")).rejects.toBeInstanceOf(PublicCatalogNotFoundError);
  });

  it("throws a plain Error when the store exists but the catalog projection doesn't", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchByUrl({
        "/publicStores/olivia": jsonResponse(200, STORE_DOC),
        "/publicCatalogs/olivia": jsonResponse(404, {}),
      })
    );
    await expect(loadPublicCatalog("olivia")).rejects.toThrow("aún no está publicado");
  });

  it("propagates non-404 HTTP failures instead of swallowing them", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchByUrl({
        "/publicStores/olivia": jsonResponse(403, { error: { message: "PERMISSION_DENIED" } }),
        "/publicCatalogs/olivia": jsonResponse(200, CATALOG_DOC),
      })
    );
    await expect(loadPublicCatalog("olivia")).rejects.toThrow("403");
  });
});

describe("loadPublicProduct (REST)", () => {
  const PRODUCT_DOC = restDoc({
    storeId: "store_olivia",
    productSlug: "anillo-luna",
    name: "Anillo Luna",
    sku: "AR-001",
    images: [],
    categories: [{ id: "c1", name: "Aretes", slug: "aretes" }],
    canInquire: true,
  });

  it("reads the detail doc with a known store (no extra reads)", async () => {
    const fetchMock = stubFetchByUrl({
      "/publicProducts/store_olivia__anillo-luna": jsonResponse(200, PRODUCT_DOC),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { product, store } = await loadPublicProduct("olivia", "anillo-luna", {
      storeId: "store_olivia",
      slug: "olivia",
      name: "Olivia",
      type: "on_demand",
    });

    expect(product.name).toBe("Anillo Luna");
    expect(product.canInquire).toBe(true);
    expect(store.slug).toBe("olivia");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to publicCatalogs for stale storefront docs without storeId", async () => {
    const staleStore = restDoc({ name: "Olivia", type: "on_demand" });
    vi.stubGlobal(
      "fetch",
      stubFetchByUrl({
        "/publicStores/olivia": jsonResponse(200, staleStore),
        "/publicCatalogs/olivia": jsonResponse(200, restDoc({ storeId: "store_olivia" })),
        "/publicProducts/store_olivia__anillo-luna": jsonResponse(200, PRODUCT_DOC),
      })
    );

    const { product } = await loadPublicProduct("olivia", "anillo-luna");
    expect(product.productSlug).toBe("anillo-luna");
  });

  it("throws PublicProductNotFoundError when the detail doc 404s", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchByUrl({
        "/publicProducts/store_olivia__anillo-luna": jsonResponse(404, {}),
      })
    );
    await expect(
      loadPublicProduct("olivia", "anillo-luna", {
        storeId: "store_olivia",
        slug: "olivia",
        name: "Olivia",
        type: "on_demand",
      })
    ).rejects.toBeInstanceOf(PublicProductNotFoundError);
  });
});
