import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPublicCatalog, loadPublicProduct, loadPublicStore, PublicCatalogNotFoundError, PublicCatalogUnpublishedError, PublicProductNotFoundError } from "./publicCatalog";

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
  storefront: { hero: { heading: "Tu nueva pieza favorita está aquí" }, seo: {} },
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

  it("throws PublicCatalogUnpublishedError when the store exists but the catalog projection doesn't (#286)", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchByUrl({
        "/publicStores/olivia": jsonResponse(200, STORE_DOC),
        "/publicCatalogs/olivia": jsonResponse(404, {}),
      })
    );
    // An honest "not published yet" state, distinguishable from a missing
    // store and from a connection failure.
    const rejection = await loadPublicCatalog("olivia").then(
      () => { throw new Error("debía fallar"); },
      (err: unknown) => err
    );
    expect(rejection).toBeInstanceOf(PublicCatalogUnpublishedError);
    expect((rejection as Error).message).toMatch("aún no está publicado");
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

  // #374: a squatted detail doc (foreign storeId in the body) must read as
  // NOT FOUND — the public reader only serves the store it was asked for.
  it("#374 un detalle con storeId ajeno se trata como inexistente", async () => {
    const squatted = restDoc({
      storeId: "sec-store-atacante",
      productSlug: "anillo-luna",
      name: "Falso Anillo",
      sku: "FAKE-1",
      images: [],
    });
    vi.stubGlobal(
      "fetch",
      stubFetchByUrl({
        "/publicProducts/store_olivia__anillo-luna": jsonResponse(200, squatted),
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

describe("#282 reintento automático único ante fallas transitorias", () => {
  const storeUrl = (url: string) => url.includes("/publicStores/olivia");

  function stubFetchSequence(responses: Array<Response | Error>) {
    return vi.fn(async (input: RequestInfo | URL) => {
      void input;
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    });
  }

  it("un 503 transitorio se reintenta una vez y la carga triunfa", async () => {
    const fetchMock = stubFetchSequence([jsonResponse(503, {}), jsonResponse(200, STORE_DOC)]);
    vi.stubGlobal("fetch", fetchMock);
    const store = await loadPublicStore("olivia");
    expect(store.name).toBe("Olivia");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => storeUrl(String(call[0])))).toBe(true);
  });

  it("un fallo de red se reintenta una vez y la carga triunfa", async () => {
    const fetchMock = stubFetchSequence([new TypeError("network blip"), jsonResponse(200, STORE_DOC)]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPublicStore("olivia")).resolves.toMatchObject({ name: "Olivia" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un 404 es una respuesta, no una falla: sin reintento", async () => {
    const fetchMock = stubFetchSequence([jsonResponse(404, {}), jsonResponse(200, STORE_DOC)]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPublicStore("olivia")).rejects.toBeInstanceOf(PublicCatalogNotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un 403 (reglas) es una respuesta dura: falla inmediata, sin reintento", async () => {
    const fetchMock = stubFetchSequence([jsonResponse(403, {}), jsonResponse(200, STORE_DOC)]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPublicStore("olivia")).rejects.toThrow(/Firestore REST 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("si el reintento también falla, el error llega a la pantalla de reintento manual", async () => {
    const fetchMock = stubFetchSequence([jsonResponse(503, {}), jsonResponse(503, {})]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPublicStore("olivia")).rejects.toThrow(/Firestore REST 503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("#286 fallo transitorio en la SEGUNDA lectura (tienda 200, catálogo 503): falla de conexión, no missing", async () => {
    // La tienda existe; el catálogo no se deja leer. Debe propagarse el error
    // de red (pantalla de reintento), jamás clasificarse como tienda ausente.
    const fetchMock = stubFetchSequence([
      jsonResponse(200, STORE_DOC),
      jsonResponse(503, {}),
      jsonResponse(503, {}),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const rejection = await loadPublicCatalog("olivia").then(
      () => { throw new Error("debía fallar"); },
      (err: unknown) => err
    );
    expect(rejection).not.toBeInstanceOf(PublicCatalogNotFoundError);
    expect(rejection).not.toBeInstanceOf(PublicCatalogUnpublishedError);
    expect((rejection as Error).message).toMatch(/Firestore REST 503/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // tienda + catálogo con su único reintento
  });
});

describe("#282 carrera de clasificación: tienda primero (secuencial)", () => {
  it("slug desconocido: NotFoundError aunque el catálogo también 404e — y sin leer el catálogo siquiera", async () => {
    // Antes: Promise.all rechazaba con el 404 que llegara primero; si ganaba
    // el del catálogo, la pantalla mostraba 'falló la conexión'. Ahora la
    // tienda es la señal autoritativa y se lee primero.
    const fetchMock = stubFetchByUrl({
      "/publicStores/": jsonResponse(404, {}),
      "/publicCatalogs/": jsonResponse(404, {}),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPublicCatalog("no-existe")).rejects.toBeInstanceOf(PublicCatalogNotFoundError);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes("/publicStores/no-existe"))).toBe(true);
    expect(urls.some((u) => u.includes("/publicCatalogs/"))).toBe(false);
  });
});

describe("loadPublicCatalog — cruce de storeId (#374 r2)", () => {
  it("un catálogo que nombra a OTRA tienda bajo el slug de Olivia se lee como inexistente", async () => {
    const fetchMock = stubFetchByUrl({
      "/publicStores/olivia": jsonResponse(200, STORE_DOC),
      "/publicCatalogs/olivia": jsonResponse(200, restDoc({
        storeId: "store_intruso",
        categories: [],
        products: [],
      })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPublicCatalog("olivia")).rejects.toThrow(PublicCatalogNotFoundError);
  });

  it("catálogo legado sin storeId sigue sirviendo (compatibilidad 390e76a)", async () => {
    const fetchMock = stubFetchByUrl({
      "/publicStores/olivia": jsonResponse(200, STORE_DOC),
      "/publicCatalogs/olivia": jsonResponse(200, restDoc({ categories: [], products: [] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { catalog } = await loadPublicCatalog("olivia");
    expect(catalog.products).toEqual([]);
  });
});
