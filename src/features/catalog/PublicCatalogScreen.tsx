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
  // #135: finish filter state — BEFORE the loading early-returns (rules of hooks).
  const [finishFilter, setFinishFilter] = useState("");
  // #137: chosen color per design (productSlug → variant id), GANNI-style
  // swatches on the card; defaults to the first color.
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({});
  const normalizeFinish = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
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
  const soldOutAware = catalog.products; // sold-out keeps its card for encargo (#135)
  const products = showSoldOut ? soldOutAware : soldOutAware.filter((product) => !isSoldOut(product));
  // #135: Dorado/Plateado finish filter — finish list derived per render
  // (cheap, no hook): unique finishes of the visible products.
  const finishes = (() => {
    const unique = new Map<string, string>();
    for (const product of products) {
      const finish = (product as { finish?: string | null }).finish?.trim();
      if (finish) unique.set(normalizeFinish(finish), finish);
    }
    return [...unique.values()];
  })();
  const finishKey = finishFilter ? normalizeFinish(finishFilter) : "";
  const visibleProducts = finishKey
    ? products.filter((product) => normalizeFinish((product as { finish?: string | null }).finish ?? "") === finishKey)
    : products;
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
    // #137: per-color lines carry `slug~variantId` keys — give each color's
    // line its OWN signal so the drawer explains exactly that color.
    for (const variant of product.variants ?? []) {
      signals[`${product.productSlug}~${variant.id}`] = isSoldOut(product) ? "agotado" : variant.stockSignal;
    }
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
        {finishes.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {finishes.map((finish) => (
              <Button
                key={finish}
                size="sm"
                variant={finishFilter === finish ? "primary" : "secondary"}
                aria-pressed={finishFilter === finish}
                onClick={() => setFinishFilter((current) => (current === finish ? "" : finish))}
              >
                {finish}
              </Button>
            ))}
          </div>
        )}
        {visibleProducts.length === 0 ? <EmptyState title="Aún no hay productos" subtitle="Vuelve pronto." /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleProducts.map((product) => {
              const variants = product.variants ?? [];
              const chosen = variants.find((v) => v.id === (chosenVariants[product.productSlug] ?? variants[0]?.id));
              const variantSoldOut = chosen ? chosen.stockSignal === "agotado" : false;
              const designPaused = isSoldOut(product);
              const soldOut = variants.length > 0 ? (designPaused || variantSoldOut) : designPaused;
              const cardImage = chosen?.imageUrl ?? product.imageUrl;
              const lineName = chosen ? `${product.name} · ${chosen.color}` : product.name;
              const lineSlug = chosen ? `${product.productSlug}~${chosen.id}` : product.productSlug;
              const lineImage = cardImage ?? undefined;
              return <Card key={product.productSlug} className="overflow-hidden p-0">
              <ProductImage src={cardImage ?? undefined} alt={lineName} size="full" />
              <div className="p-4"><h2 className="serif-display text-lg font-semibold text-ink">{product.name}</h2>
                {soldOut && <div className="mt-1"><Badge tone="neutral">Agotado</Badge></div>}
                {/* #137/#124: one design, its colors as GANNI-style swatches —
                    accessible name, pressed state, ≥40px target. Choosing a color
                    swaps the card photo and availability without leaving the grid. */}
                {product.variants && product.variants.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {product.variants.map((variant) => {
                      const pressed = (chosenVariants[product.productSlug] ?? product.variants![0].id) === variant.id;
                      return (
                        <Button
                          key={variant.id}
                          size="sm"
                          variant={pressed ? "primary" : "secondary"}
                          aria-pressed={pressed}
                          title={variant.stockSignal === "agotado" ? `${variant.color} (agotado)` : variant.color}
                          onClick={() => setChosenVariants((current) => ({ ...current, [product.productSlug]: variant.id }))}
                          className={`!min-h-[40px] !min-w-[44px] ${variant.stockSignal === "agotado" ? "line-through opacity-60" : ""}`}
                        >
                          {variant.color}
                        </Button>
                      );
                    })}
                  </div>
                )}
                {product.publicDescription && <p className="text-sm text-ink-soft mt-1">{product.publicDescription}</p>}
                <PublicTierPrices store={store} product={product} />
                {!soldOut ? (
                  <CartProductControl
                    key={`${lineSlug}-${quantityBySlug.get(lineSlug) ?? 0}`}
                    productSlug={lineSlug}
                    productName={lineName}
                    quantity={quantityBySlug.get(lineSlug) ?? 0}
                    onAdd={() => cart.add({ ...cartItemFromPublicProduct({ ...product, image: lineImage }), ...(chosen ? { productSlug: lineSlug, name: lineName } : {}) })}
                    onSetQty={cart.setQty}
                    full
                    className="mt-2"
                  />
                ) : (
                  // #135/#137: agotado (el diseño o el color elegido) SIGUE
                  // solicitable por encargo — línea con el color inequívoco.
                  <div className="mt-2">
                    <Button
                      variant="secondary"
                      full
                      onClick={() => cart.add({ ...cartItemFromPublicProduct({ ...product, image: lineImage }), ...(chosen ? { productSlug: lineSlug, name: lineName } : {}), inquire: true })}
                    >
                      Pedir por encargo
                    </Button>
                    <p className="text-xs text-on-surface-soft mt-1">
                      Agotado{chosen ? ` (${chosen.color})` : ""} · puedes pedirlo por encargo. Fecha de entrega por confirmar.
                    </p>
                  </div>
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
