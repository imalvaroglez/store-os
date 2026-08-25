import { useEffect, useState } from "react";
import { Button, Card, EmptyState, ProductImage, SkeletonCard } from "../../design-system";
import { formatMoney, publicPrice } from "../../lib/money";
import { createWhatsAppStoreUrl } from "../../lib/whatsapp";
import { loadPublicCatalog, PublicCatalogNotFoundError, type PublicCatalog, type PublicProductSummary, type PublicStore } from "../../app/firebase/publicCatalog";
import { CartSheet } from "./cart/CartSheet";
import { useCart } from "./cart/useCart";
import { cartCheckout } from "./cart/useCartCheckout";

// Generic public catalog for every store except Olivia. It deliberately keeps
// the established Store OS look instead of inheriting Olivia's fixed brand.
export function PublicCatalogScreen({ slug }: { slug: string }) {
  const [data, setData] = useState<{ store: PublicStore; catalog: PublicCatalog } | null>(null);
  const [failed, setFailed] = useState(false);
  const cart = useCart();
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    loadPublicCatalog(slug).then((next) => {
      if (!cancelled) setData(next);
    }).catch((error) => {
      if (!cancelled && error instanceof PublicCatalogNotFoundError) setFailed(true);
      else if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [slug]);

  if (!data && !failed) {
    return <div className="min-h-full bg-paper p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  }
  if (!data) return <div className="min-h-full flex items-center justify-center p-6"><EmptyState title="Tienda no encontrada" subtitle="Este catálogo no existe o no está disponible." /></div>;

  const { store, catalog } = data;
  const checkout = cartCheckout(slug, cart);

  return (
    <div className="min-h-full bg-paper">
      <header className="bg-ink text-paper px-5 py-8">
        <div className="mx-auto max-w-6xl flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-terracotta-soft">Catálogo</p>
            <h1 className="serif-display text-3xl font-semibold mt-1">{store.name}</h1>
            <a href={createWhatsAppStoreUrl(store as never)} target="_blank" rel="noreferrer" className="inline-block mt-5"><Button variant="success">Preguntar por WhatsApp</Button></a>
          </div>
          {cart.count > 0 && (
            <Button variant="secondary" onClick={() => setCartOpen(true)}>
              🛒 {cart.count}
            </Button>
          )}
        </div>
      </header>
      <main className="p-4 md:p-8"><div className="mx-auto max-w-6xl">
        {catalog.products.length === 0 ? <EmptyState title="Aún no hay productos" subtitle="Vuelve pronto." /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.products.map((product) => <Card key={product.productSlug} className="overflow-hidden p-0">
              <ProductImage src={product.imageUrl ?? undefined} alt={product.name} size="full" />
              <div className="p-4"><h2 className="serif-display text-lg font-semibold text-ink">{product.name}</h2>
                {product.publicDescription && <p className="text-sm text-ink-soft mt-1">{product.publicDescription}</p>}
                <div className="flex items-center justify-between gap-3 mt-4"><span className="serif-display text-xl font-semibold">{formatMoney(publicPrice(product))}</span>
                  <AddToCartButton product={product} onAdd={() => cart.add({
                    productSlug: product.productSlug,
                    name: product.name,
                    price: publicPrice(product) ?? 0,
                    imageUrl: product.imageUrl ?? null,
                    availableQuantity: product.availableQuantity,
                  })} />
                </div>
              </div>
            </Card>)}
          </div>
        )}
      </div></main>

      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        whatsappPhone={store.whatsappPhone}
        items={cart.items}
        total={cart.total}
        setQty={cart.setQty}
        remove={cart.remove}
        onSubmit={checkout}
      />
    </div>
  );
}

function AddToCartButton({ product, onAdd }: { product: PublicProductSummary; onAdd: () => void }) {
  const soldOut = product.availability === "sold_out" || product.availableQuantity === 0;
  return (
    <Button variant="secondary" disabled={soldOut} onClick={onAdd}>
      {soldOut ? "Agotado" : "Agregar"}
    </Button>
  );
}
