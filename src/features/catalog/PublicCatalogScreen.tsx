import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ProductImage, SkeletonCard } from "../../design-system";
import { createWhatsAppStoreUrl } from "../../lib/whatsapp";
import {
  loadPublicCatalog,
  PublicCatalogNotFoundError,
  PublicCatalogUnpublishedError,
  type PublicCatalog,
  type PublicStore,
  type PublicStockSignal,
} from "../../app/firebase/publicCatalog";
import { cartItemFromPublicProduct, cartPieces, pruneCartLines } from "../../lib/cart";
import { useCart } from "./useCart";
import { useSeo } from "./useSeo";
import { CartDrawer, CartFloatingButton, CartProductControl, PublicTierPrices } from "./CartDrawer";

// Generic public catalog for every store except Olivia. It deliberately keeps
// the established Store OS look instead of inheriting Olivia's fixed brand.
export function PublicCatalogScreen({ slug }: { slug: string }) {
  const [data, setData] = useState<{ store: PublicStore; catalog: PublicCatalog } | null>(null);
  // #276: a missing store and a network failure are DIFFERENT things — a
  // clienta on flaky mobile data must never read "this catalog does not
  // exist" (and a wrong slug must not promise the store still exists).
  // #286: an unpublished catalog is a third thing — the store exists, the
  // connection is fine; no fake "revisa tu conexión" with a useless retry.
  const [loadState, setLoadState] = useState<"loading" | "missing" | "unpublished" | "failed">("loading");
  const cart = useCart(slug);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadState("loading");
    loadPublicCatalog(slug).then((next) => {
      if (!cancelled) setData(next);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setLoadState(
        err instanceof PublicCatalogNotFoundError
          ? "missing"
          : err instanceof PublicCatalogUnpublishedError
            ? "unpublished"
            : "failed"
      );
    });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!data) return;
    cart.prune(new Set(data.catalog.products.map((product) => product.productSlug)));
    cart.refresh(data.catalog.products.map(cartItemFromPublicProduct));
  }, [cart.prune, cart.refresh, data]);

  // Same per-route SEO contract as the Olivia storefront: title/canonical/og
  // for crawlers that execute JS. Social previews read the prerendered HTML
  // (scripts/prerender-public.mjs rewrites these tags per store at deploy).
  useSeo({
    title: data ? `${data.store.name} — Catálogo` : "Catálogo",
    description: data?.store.storefront?.seo?.description ?? data?.store.storefront?.hero?.body ?? "Explora el catálogo, elige tus piezas y prepara tu pedido por WhatsApp.",
    canonicalPath: `/catalogo/${slug}`,
    ogImageUrl: data?.store.storefront?.seo?.ogImageUrl ?? data?.store.storefront?.hero?.imageUrl,
    jsonLd: data
      ? { "@context": "https://schema.org", "@type": "Store", name: data.store.name, url: `${window.location.origin}/catalogo/${slug}` }
      : undefined,
  });

  if (!data && loadState === "loading") {
    return <div className="min-h-full bg-paper p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  }
  if (!data && loadState === "unpublished") {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <EmptyState
          title="Catálogo no disponible por ahora"
          subtitle="Esta tienda todavía no publica sus piezas. Vuelve pronto."
        />
      </div>
    );
  }
  if (!data && loadState === "failed") {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <EmptyState
          title="No se pudo cargar el catálogo"
          subtitle="Revisa tu conexión e inténtalo de nuevo."
          action={<Button onClick={() => window.location.reload()}>Reintentar</Button>}
        />
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-full flex items-center justify-center p-6"><EmptyState title="Tienda no encontrada" subtitle="Este catálogo no existe o no está disponible." /></div>;
  }

  const { store, catalog } = data;
  // #371: the SAME truth Olivia's storefront uses — a manual «Agotado» pause
  // (availability) or a real empty shelf (stockSignal) applies to EVERY
  // store's public catalog, and «Agotados: Ocultos» hides them from the grid.
  const isSoldOut = (product: { availability?: string | null; stockSignal?: string | null }) =>
    product.availability === "sold_out" || product.stockSignal === "agotado";
  const showSoldOut = store.storefront?.showSoldOut ?? true;
  const products = showSoldOut ? catalog.products : catalog.products.filter((product) => !isSoldOut(product));
  const visibleSlugs = new Set(products.map((product) => product.productSlug));
  const visibleLines = pruneCartLines(cart.lines, visibleSlugs);
  // #305: primary category name per product, from the SAME projection the
  // grid uses (no extra reads). "Sin categoría" is the drawer's fallback.
  const categoryNameBySlug = Object.fromEntries(products.map((product) => [
    product.productSlug,
    catalog.categories.find((category) => product.categoryIds?.[0] === category.id)?.name ?? "",
  ]));
  const pieces = cartPieces(visibleLines);
  const quantityBySlug = new Map(visibleLines.map((line) => [line.productSlug, line.qty]));
  // A paused piece reads as agotado EVERYWHERE — including a cart saved before
  // the pause: the drawer turns that line into "sobre pedido", never a firm order.
  const signalBySlug = products.reduce<Record<string, PublicStockSignal>>((signals, product) => {
    signals[product.productSlug] = isSoldOut(product) ? "agotado" : (product.stockSignal ?? "disponible");
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
        {products.length === 0 ? <EmptyState title="Aún no hay productos" subtitle="Vuelve pronto." /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => { const soldOut = isSoldOut(product); return <Card key={product.productSlug} className="overflow-hidden p-0">
              <ProductImage src={product.imageUrl ?? undefined} alt={product.name} size="full" />
              <div className="p-4"><h2 className="serif-display text-lg font-semibold text-ink">{product.name}</h2>
                {soldOut && <div className="mt-1"><Badge tone="neutral">Agotado</Badge></div>}
                {/* #124: one design, its colors listed — never N loose fichas. */}
                {product.variants && product.variants.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1 text-xs text-ink-soft">
                    {product.variants.map((variant) => (
                      <span
                        key={variant.id}
                        className={`rounded-full border border-ink/15 px-2 py-0.5 ${variant.stockSignal === "agotado" ? "opacity-50 line-through" : ""}`}
                      >
                        {variant.color}
                      </span>
                    ))}
                  </p>
                )}
                {product.publicDescription && <p className="text-sm text-ink-soft mt-1">{product.publicDescription}</p>}
                <PublicTierPrices store={store} product={product} />
                {/* #371: una pieza agotada o en pausa no se solicita aquí; si ya
                    estaba en un carrito guardado, el cajón la pasa a sobre pedido. */}
                {!soldOut && (
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
                )}
              </div>
            </Card>;})}
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
        categoryNameBySlug={categoryNameBySlug}
      />
    </div>
  );
}
