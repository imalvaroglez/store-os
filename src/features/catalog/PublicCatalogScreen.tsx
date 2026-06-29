import { useEffect, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  ProductImage,
  Spinner,
} from "../../design-system";
import { publicPrice } from "../../lib/money";
import { formatMoney } from "../../lib/money";
import { createWhatsAppProductUrl, createWhatsAppStoreUrl } from "../../lib/whatsapp";
import {
  loadPublicCatalog,
  PublicCatalogNotFoundError,
  type PublicStore as PublicCatalogStore,
  type PublicProduct as PublicCatalogProduct,
} from "../../app/firebase/publicCatalog";

// Public-facing catalog at /catalogo/:slug. Shows ONLY public fields.
// Never shows: cost, profit, private notes, customers, orders, inventory counts.
// Loads directly from the public projection collections — works for anonymous
// visitors (no session) and signed-in non-members alike.
export function PublicCatalogScreen({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [store, setStore] = useState<PublicCatalogStore | null>(null);
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadPublicCatalog(slug)
      .then((data) => {
        if (cancelled) return;
        setStore(data.store);
        setProducts(data.products);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err instanceof PublicCatalogNotFoundError ? "notfound" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (status === "loading") {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <Spinner label="Cargando catálogo…" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <EmptyState
          title="No se pudo cargar"
          subtitle="Revisa tu conexión e intenta de nuevo."
          action={
            <Button onClick={() => loadRetry(slug, setStore, setProducts, setStatus)}>
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }

  if (status === "notfound" || !store) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <EmptyState
          title="Tienda no encontrada"
          subtitle="Este catálogo no existe o no está disponible."
        />
      </div>
    );
  }

  const isTiered = store.type === "inventory_tiered";

  return (
    <div className="min-h-full bg-paper">
      <header className="bg-ink text-paper px-5 md:px-8 pt-8 pb-7 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(circle_at_20%_0%,#fff,transparent_45%)]" />
        <div className="relative mx-auto max-w-6xl">
          <span className="inline-block text-[10px] uppercase tracking-[0.2em] text-terracotta-soft font-semibold">
            Catálogo
          </span>
          <h1 className="serif-display text-3xl md:text-4xl font-semibold mt-1 leading-tight">
            {store.name}
          </h1>
          <p className="text-paper/70 text-sm mt-1">
            {isTiered ? "Catálogo de productos" : "Catálogo bajo pedido"}
          </p>
          <a
            href={createWhatsAppStoreUrl(whatsappStore(store))}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-5"
          >
            <Button variant="success">Preguntar por WhatsApp</Button>
          </a>
        </div>
      </header>

      <main className="p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
        {products.length === 0 ? (
          <EmptyState title="Aún no hay productos" subtitle="Vuelve pronto." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => {
            const price = publicPrice(p);
            return (
              <Card key={p.id} className="overflow-hidden p-0">
                <ProductImage src={p.imageUrl ?? undefined} alt={p.name} size="full" />
                <div className="p-4">
                  <h2 className="serif-display font-semibold text-lg text-ink">{p.name}</h2>
                  {p.publicDescription && (
                    <p className="text-sm text-ink-soft mt-1">{p.publicDescription}</p>
                  )}
                  <div className="flex items-center justify-between gap-3 mt-4">
                    <span className="serif-display tnum text-2xl font-semibold text-ink">
                      {formatMoney(price)}
                    </span>
                    <a
                      href={createWhatsAppProductUrl(whatsappProduct(p), whatsappStore(store))}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0"
                    >
                      <Button variant="success" className="whitespace-nowrap">Pedir por WhatsApp</Button>
                    </a>
                  </div>
                </div>
              </Card>
            );
          })}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}

// Retry handler for the error state.
function loadRetry(
  slug: string,
  setStore: (s: PublicCatalogStore | null) => void,
  setProducts: (p: PublicCatalogProduct[]) => void,
  setStatus: (s: "loading" | "ready" | "notfound" | "error") => void
) {
  setStatus("loading");
  loadPublicCatalog(slug)
    .then((data) => {
      setStore(data.store);
      setProducts(data.products);
      setStatus("ready");
    })
    .catch((err) => setStatus(err instanceof PublicCatalogNotFoundError ? "notfound" : "error"));
}

// The WhatsApp helpers are typed for the full Store/Product; the public
// projection only has the fields they actually use (name + whatsappPhone).
function whatsappStore(store: PublicCatalogStore) {
  return { name: store.name, whatsappPhone: store.whatsappPhone ?? undefined } as Parameters<
    typeof createWhatsAppStoreUrl
  >[0];
}
function whatsappProduct(p: PublicCatalogProduct) {
  return { name: p.name } as Parameters<typeof createWhatsAppProductUrl>[0];
}
