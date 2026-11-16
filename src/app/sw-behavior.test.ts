import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// #359: the panel's service worker (scope /) also controls the PUBLIC catalog
// origin-wide. These tests drive the REAL public/sw.js in a sandbox so its
// fetch handler can never regress into serving public routes or stale assets.

type Handler = (event: {
  request: { method: string; mode: string; url: string };
  respondWith: (p: Promise<unknown>) => void;
  waitUntil: (p: Promise<unknown>) => void;
}) => void;

function loadServiceWorker(fetchImpl: typeof fetch, cacheMatch: (url: string) => Promise<unknown>) {
  const handlers: Handler[] = [];
  const cache = {
    match: (req: { url: string }) => cacheMatch(req.url),
    put: vi.fn(async () => {}),
  };
  const sandboxSelf = {
    addEventListener: (kind: string, handler: Handler) => {
      if (kind === "fetch") handlers.push(handler);
    },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const sandbox = {
    self: sandboxSelf,
    // caches.match is the REAL cross-cache lookup — route it to the stub.
    caches: { open: async () => cache, keys: async () => ["store-os-v2"], delete: async () => true, match: async (req: { url: string }) => cacheMatch(req.url) },
    fetch: fetchImpl,
    Request: undefined,
    Response,
    URL,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function("self", "caches", "fetch", "URL", "Response", readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8"));
  run(sandbox.self, sandbox.caches, sandbox.fetch, URL, Response);
  return { handlers, cache };
}

function fire(handlers: Handler[], request: { method?: string; mode?: string; url: string }) {
  let responded: Promise<unknown> | null = null;
  const event = {
    request: { method: request.method ?? "GET", mode: request.mode ?? "no-cors", url: request.url },
    respondWith: (p: Promise<unknown>) => {
      responded = p;
    },
    waitUntil: () => {},
  };
  for (const handler of handlers) handler(event);
  return { intercepted: () => responded !== null, response: () => responded as Promise<Response> };
}

const networkResponse = () => new Response("net", { status: 200 });

describe("service worker / public catalog hardening (#359)", () => {
  it("las rutas públicas /catalogo/* NUNCA son interceptadas (paso directo a red)", () => {
    const { handlers } = loadServiceWorker(vi.fn(async () => networkResponse()), async () => new Response("cached"));
    const nav = fire(handlers, { mode: "navigate", url: "https://app/catalogo/olivia" });
    expect(nav.intercepted()).toBe(false);
    const asset = fire(handlers, { url: "https://app/catalogo/olivia/imagen.jpg" });
    expect(asset.intercepted()).toBe(false);
  });

  it("las peticiones que sí controla van a RED primero: un hit de caché viejo no gana", async () => {
    const fetchMock = vi.fn(async () => networkResponse());
    // La caché tiene la imagen VIEJA; la red tiene la nueva.
    const { handlers } = loadServiceWorker(fetchMock, async () => new Response("vieja"));
    const shot = fire(handlers, { url: "https://app/images/olivia-logo.png" });
    expect(shot.intercepted()).toBe(true);
    const res = await shot.response();
    expect(await res.text()).toBe("net"); // la red manda, no el hit viejo
    expect(fetchMock).toHaveBeenCalled();
  });

  it("sin red, la caché sirve de respaldo (offline intacto)", async () => {
    const { handlers } = loadServiceWorker(
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
      async () => new Response("cache-offline")
    );
    const shot = fire(handlers, { url: "https://app/images/olivia-logo.png" });
    const res = await shot.response();
    expect(await res.text()).toBe("cache-offline");
  });

  it("las navegaciones siguen network-first con respaldo de caché (comportamiento vigente)", async () => {
    const fetchMock = vi.fn(async () => networkResponse());
    const { handlers } = loadServiceWorker(fetchMock, async () => new Response("nav-cache"));
    const nav = fire(handlers, { mode: "navigate", url: "https://app/pedidos" });
    expect(nav.intercepted()).toBe(true);
    const res = await nav.response();
    expect(await res.text()).toBe("net");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("las respuestas no-navegación nunca se escriben a la caché del SW", async () => {
    const { handlers, cache } = loadServiceWorker(vi.fn(async () => networkResponse()), async () => undefined);
    const shot = fire(handlers, { url: "https://app/images/olivia-logo.png" });
    await shot.response();
    expect(cache.put).not.toHaveBeenCalled();
  });
});
