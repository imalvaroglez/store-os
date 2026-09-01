import { useEffect, useState } from "react";
import { Button, Card, EmptyState, ProductImage, SkeletonCard } from "../../design-system";
import { createWhatsAppStoreUrl } from "../../lib/whatsapp";
import {
  loadPublicCatalog,
  type PublicCatalog,
  type PublicStore,
  type PublicStockSignal,
} from "../../app/firebase/publicCatalog";
import { cartItemFromPublicProduct, cartPieces, pruneCartLines } from "../../lib/cart";
import { useCart } from "./useCart";
import { CartDrawer, CartFloatingButton, CartProductControl, PublicTierPrices } from "./CartDrawer";

// Generic public catalog for every store except Olivia. It deliberately keeps
// the established Store OS look instead of inheriting Olivia's fixed brand.
export function PublicCatalogScreen({ slug }: { slug: string }) {
  const [data, setData] = useState<{ store: PublicStore; catalog: PublicCatalog } | null>(null);
  const [failed, setFailed] = useState(false);
  const cart = useCart(slug);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    loadPublicCatalog(slug).then((next) => {
      if (!cancelled) setData(next);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!data) return;
    cart.prune(new Set(data.catalog.products.map((product) => product.productSlug)));
    cart.refresh(data.catalog.products.map(cartItemFromPublicProduct));
  }, [cart.prune, cart.refresh, data]);

  if (!data && !failed) {
    return <div className="min-h-full bg-paper p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  }
  if (!data) return <div className="min-h-full flex items-center justify-center p-6"><EmptyState title="Tienda no encontrada" subtitle="Este catálogo no existe o no está disponible." /></div>;

  const { store, catalog } = data;
  const visibleSlugs = new Set(catalog.products.map((product) => product.productSlug));
  const visibleLines = pruneCartLines(cart.lines, visibleSlugs);
  const pieces = cartPieces(visibleLines);
  const quantityBySlug = new Map(visibleLines.map((line) => [line.productSlug, line.qty]));
  const signalBySlug = catalog.products.reduce<Record<string, PublicStockSignal>>((signals, product) => {
    if (product.stockSignal) signals[product.productSlug] = product.stockSignal;
    return signals;
  }, {});
  return (
    <div className="min-h-full bg-paper">
      <header className="bg-ink text-paper px-5 py-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs uppercase tracking-widest text-terracotta-soft">Catálogo</p>
          <h1 className="serif-display text-3xl font-semibold mt-1">{store.name}</h1>
          <a href={createWhatsAppStoreUrl(store as never)} target="_blank" rel="noreferrer" className="inline-block mt-5"><Button variant="success">Preguntar por WhatsApp</Button></a>
        </div>
      </header>
      <main className="p-4 md:p-8"><div className="mx-auto max-w-6xl">
        {catalog.products.length === 0 ? <EmptyState title="Aún no hay productos" subtitle="Vuelve pronto." /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.products.map((product) => <Card key={product.productSlug} className="overflow-hidden p-0">
              <ProductImage src={product.imageUrl ?? undefined} alt={product.name} size="full" />
              <div className="p-4"><h2 className="serif-display text-lg font-semibold text-ink">{product.name}</h2>
                {product.publicDescription && <p className="text-sm text-ink-soft mt-1">{product.publicDescription}</p>}
                <PublicTierPrices store={store} product={product} />
                <CartProductControl
                  key={`${product.productSlug}-${quantityBySlug.get(product.productSlug) ?? 0}`}
                  productSlug={product.productSlug}
                  productName={product.name}
                  quantity={quantityBySlug.get(product.productSlug) ?? 0}
                  onAdd={() => cart.add(cartItemFromPublicProduct(product))}
                  onSetQty={cart.setQty}
                  full
                  className="mt-2"
                />
              </div>
            </Card>)}
          </div>
        )}
      </div></main>

      {!cartOpen && <CartFloatingButton pieces={pieces} onClick={() => setCartOpen(true)} />}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        store={store}
        lines={visibleLines}
        signalBySlug={signalBySlug}
        visibleSlugs={visibleSlugs}
        onSetQty={cart.setQty}
        onRemove={cart.remove}
      />
    </div>
  );
}
