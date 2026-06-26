import { useStore } from "../../app/StoreProvider";
import {
  Button,
  Card,
  EmptyState,
  ProductImage,
} from "../../design-system";
import { publicProductsForStore } from "../../lib/selectors";
import { publicPrice } from "../../lib/money";
import { formatMoney } from "../../lib/money";
import { createWhatsAppProductUrl, createWhatsAppStoreUrl } from "../../lib/whatsapp";

// Public-facing catalog at /catalogo/:slug. Shows ONLY public fields.
// Never shows: cost, profit, private notes, customers, orders, inventory counts.
export function PublicCatalogScreen({ slug }: { slug: string }) {
  const { state } = useStore();
  const store = state.stores.find((s) => s.slug === slug);

  if (!store) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <EmptyState
          title="Tienda no encontrada"
          subtitle="Este catálogo no existe o no está disponible."
        />
      </div>
    );
  }

  const products = publicProductsForStore(state.products, store.id);
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
          <p className="text-stone-300 text-sm mt-1">
            {isTiered ? "Catálogo de productos" : "Catálogo bajo pedido"}
          </p>
          <a
            href={createWhatsAppStoreUrl(store)}
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
                <ProductImage src={p.imageUrl} alt={p.name} size="full" />
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
                      href={createWhatsAppProductUrl(p, store)}
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
