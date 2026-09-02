import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, SkeletonCard, ProductImage, OLIVIA_BRAND } from "../../design-system";
import {
  loadPublicCatalog,
  loadPublicProduct,
  PublicCatalogNotFoundError,
  type PublicStore,
  type PublicCatalog,
  type PublicProductSummary,
  type PublicProductDetail,
  type PublicStockSignal,
} from "../../app/firebase/publicCatalog";
import type { RouteMatch } from "../../lib/router";
import { navigate } from "../../lib/router";
import { publicPrice } from "../../lib/money";
import {
  createStorefrontBuyUrl,
  createStorefrontContactUrl,
  createStorefrontResaleUrl,
} from "../../lib/whatsapp";
import { useSeo } from "./useSeo";
import { useCart } from "./useCart";
import { CartDrawer, CartFloatingButton, CartProductControl, PublicTierPrices } from "./CartDrawer";
import { cartItemFromPublicProduct, cartPieces, pruneCartLines, type CartLine } from "../../lib/cart";
import type { Storefront } from "../../types";

// --- Public cart (context) -------------------------------------------------
//
// One cart per storefront visit, scoped to the store slug and persisted in
// localStorage (src/lib/cart.ts). StoreChrome owns the state so the floating
// button, the grid's add buttons and the detail's CTA all stay in sync.

type CartContextValue = {
  store: PublicStore;
  lines: CartLine[];
  signalBySlug?: Record<string, PublicStockSignal>;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (item: Omit<CartLine, "qty">, qty?: number) => void;
  setQty: (productSlug: string, qty: number) => void;
  remove: (productSlug: string) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function useCartContext(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("El carrito solo vive dentro de StoreChrome con tienda cargada.");
  return ctx;
}

// Olivia's public storefront. Handles all three public sub-routes (store home,
// category, product) in one component so they share the brand chrome, the store
// + catalog load, and the WhatsApp helpers. Anonymous-readable; never shows
// private fields.
export function OliviaStorefront({ route }: { route: RouteMatch }) {
  if (route.name === "public_product") {
    return <ProductView slug={route.params.slug} productSlug={route.params.productSlug} />;
  }
  if (route.name === "public_category") {
    return <StoreView slug={route.params.slug} focusCategory={route.params.categorySlug} />;
  }
  return <StoreView slug={(route.params as { slug: string }).slug} />;
}

// --- Brand chrome ---------------------------------------------------------

function BrandStyle() {
  // Scoped CSS variables for Olivia's fixed brand. Applied to the storefront
  // root only; the admin panel keeps the regular app theme.
  return (
    <style>{`
      .olivia-root {
        --olv-bg: ${OLIVIA_BRAND.bg};
        --olv-ink: ${OLIVIA_BRAND.ink};
        --olv-ink-soft: ${OLIVIA_BRAND.inkSoft};
        --olv-accent: ${OLIVIA_BRAND.accent};
        --olv-accent-soft: ${OLIVIA_BRAND.accentSoft};
        --olv-rule: ${OLIVIA_BRAND.rule};
        --olv-display: ${OLIVIA_BRAND.fontDisplay};
        --olv-body: ${OLIVIA_BRAND.fontBody};
        background: var(--olv-bg);
        color: var(--olv-ink);
        font-family: var(--olv-body);
      }
      .olivia-root h1, .olivia-root h2, .olivia-root .olv-display {
        font-family: var(--olv-display);
      }
    `}</style>
  );
}

function ContactFallback({ store }: { store: PublicStore }) {
  // If WhatsApp can't open (no phone), show the raw number so contact is still
  // possible. Never promise a reservation.
  if (!store.whatsappPhone) return null;
  return (
    <p className="olv-ink-soft text-sm mt-2">
      Escríbeme al <span className="olv-ink font-semibold">{store.whatsappPhone}</span>
    </p>
  );
}

// --- Store home + category view -------------------------------------------

function StoreView({ slug, focusCategory }: { slug: string; focusCategory?: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [store, setStore] = useState<PublicStore | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadPublicCatalog(slug)
      .then((data) => {
        if (cancelled) return;
        setStore(data.store);
        setCatalog(data.catalog);
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

  // SEO must be an unconditional hook call (before early returns). Derive from
  // possibly-null store/catalog; no-op metadata when not ready.
  const sfForSeo = (store?.storefront ?? {}) as Storefront;
  const activeCategoryForSeo = focusCategory
    ? catalog?.categories.find((c) => c.slug === focusCategory)
    : undefined;
  useSeo({
    title: activeCategoryForSeo
      ? `${activeCategoryForSeo.name} · ${store?.name ?? ""}`
      : sfForSeo.seo?.title ?? store?.name ?? "Store OS",
    description: sfForSeo.seo?.description ?? sfForSeo.hero?.body,
    canonicalPath: activeCategoryForSeo
      ? `/catalogo/${slug}/categoria/${activeCategoryForSeo.slug}`
      : `/catalogo/${slug}`,
    ogImageUrl: sfForSeo.seo?.ogImageUrl ?? sfForSeo.hero?.imageUrl,
    jsonLd: store
      ? {
          "@context": "https://schema.org",
          "@type": "Store",
          name: store.name,
          description: sfForSeo.seo?.description ?? sfForSeo.hero?.body,
          image: sfForSeo.seo?.ogImageUrl ?? sfForSeo.hero?.imageUrl,
          url: `${window.location.origin}/catalogo/${slug}`,
        }
      : undefined,
  });

  if (status === "loading") {
    return (
      <StoreChrome>
        <div className="mx-auto max-w-6xl grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </StoreChrome>
    );
  }
  if (status === "error") {
    return (
      <StoreChrome>
        <Centered>
          <EmptyState title="No se pudo cargar" subtitle="Revisa tu conexión e intenta de nuevo." />
        </Centered>
      </StoreChrome>
    );
  }
  if (status === "notfound" || !store || !catalog) {
    return (
      <StoreChrome>
        <Centered>
          <EmptyState title="Tienda no encontrada" subtitle="Este catálogo no existe o no está disponible." />
        </Centered>
      </StoreChrome>
    );
  }

  const sf = (store.storefront ?? {}) as Storefront;
  const showSoldOut = sf.showSoldOut ?? true;

  // Visible products: hide sold-out unless the store allows them; never show
  // drafts/archived (already excluded by the projection).
  const visibleProducts = catalog.products.filter(
    (p) => showSoldOut || p.availability !== "sold_out"
  );

  // Category-filtered view vs. full home.
  const activeCategory = focusCategory
    ? catalog.categories.find((c) => c.slug === focusCategory)
    : undefined;
  const productsInScope = activeCategory
    ? visibleProducts.filter((p) => p.categoryIds?.includes(activeCategory.id))
    : visibleProducts;

  const featured = visibleProducts.filter((p) => p.isFeatured).slice(0, 6);
  const isNew = visibleProducts.filter((p) => p.isNew).slice(0, 6);

  const heroImg = sf.hero?.imageUrl;

  const signalBySlug = Object.fromEntries(
    catalog.products.map((p) => [p.productSlug, p.stockSignal ?? "disponible"])
  );
  return (
    <StoreChrome
      store={store}
      signalBySlug={signalBySlug}
      visibleSlugs={new Set(catalog.products.map((p) => p.productSlug))}
      cartItems={catalog.products.map(cartItemFromPublicProduct)}
    >
      {/* Hero */}
      <section className="relative">
        {heroImg && (
          <div className="absolute inset-0 overflow-hidden">
            <img src={heroImg} alt="" className="w-full h-full object-cover opacity-30" />
          </div>
        )}
        <div className="relative mx-auto max-w-3xl px-5 py-16 text-center">
          <h1 className="olv-display text-4xl md:text-5xl font-semibold">{sf.hero?.heading || store.name}</h1>
          {sf.hero?.body && <p className="olv-ink-soft mt-3 text-lg">{sf.hero.body}</p>}
          {(sf.benefits ?? []).length > 0 && (
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-5 text-sm">
              {sf.benefits!.map((b, i) => (
                <li key={i} className="olv-ink-soft">· {b}</li>
              ))}
            </ul>
          )}
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a href={createStorefrontContactUrl(store, slug)} target="_blank" rel="noreferrer">
              <Button variant="primary" className="bg-[var(--olv-accent)] text-white hover:opacity-90">Contactar</Button>
            </a>
            {sf.resale && (
              <a href={createStorefrontResaleUrl(store, slug)} target="_blank" rel="noreferrer">
                <Button variant="secondary">Vende con nosotros</Button>
              </a>
            )}
          </div>
        </div>
      </section>

      {sf.notice && (
        <div className="bg-[var(--olv-accent-soft)] text-center text-sm py-2 px-4">
          {sf.notice}
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-8 space-y-12">
        {/* Category nav (anchor scroll on home; route on category pages) */}
        {catalog.categories.length > 0 && (
          <nav aria-label="Categorías" className="flex flex-wrap justify-center gap-2">
            <CatChip active={!focusCategory} href={`/catalogo/${slug}`}>Todo</CatChip>
            {catalog.categories.map((c) => (
              <CatChip
                key={c.id}
                active={focusCategory === c.slug}
                href={`/catalogo/${slug}/categoria/${c.slug}`}
              >
                {c.name}
              </CatChip>
            ))}
          </nav>
        )}

        {activeCategory && (
          <section>
            <h2 className="olv-display text-2xl font-semibold">{activeCategory.name}</h2>
            {activeCategory.description && <p className="olv-ink-soft mt-1">{activeCategory.description}</p>}
          </section>
        )}

        {/* Featured (home only) */}
        {!activeCategory && featured.length > 0 && (
          <Section title="Destacados">
            <ProductGrid products={featured} slug={slug} />
          </Section>
        )}

        {/* New (home only) */}
        {!activeCategory && isNew.length > 0 && (
          <Section title="Novedades">
            <ProductGrid products={isNew} slug={slug} />
          </Section>
        )}

        {/* Full catalog / category scope */}
        <Section title={activeCategory ? undefined : "Catálogo"}>
          {productsInScope.length === 0 ? (
            <EmptyState title="Sin piezas aquí" subtitle={activeCategory ? "Prueba otra categoría." : "Vuelve pronto."} />
          ) : (
            <ProductGrid products={productsInScope} slug={slug} />
          )}
        </Section>

        {/* Story */}
        {sf.story?.body && !activeCategory && (
          <Section title={sf.story.heading || "Nuestra historia"}>
            <p className="olv-ink-soft max-w-2xl whitespace-pre-line">{sf.story.body}</p>
          </Section>
        )}

        {/* Resale */}
        {sf.resale?.body && !activeCategory && (
          <Section title={sf.resale.heading || "Vende con nosotros"}>
            <p className="olv-ink-soft max-w-2xl whitespace-pre-line">{sf.resale.body}</p>
            <a href={createStorefrontResaleUrl(store, slug)} target="_blank" rel="noreferrer" className="inline-block mt-3">
              <Button variant="primary" className="bg-[var(--olv-accent)] text-white hover:opacity-90">
                Quiero revender
              </Button>
            </a>
          </Section>
        )}

        {/* FAQ */}
        {(sf.faq ?? []).length > 0 && !activeCategory && (
          <Section title="Preguntas frecuentes">
            <div className="space-y-2 max-w-2xl">
              {sf.faq!.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)}
            </div>
          </Section>
        )}

        {/* Contact + info */}
        <Section title="Contacto">
          <div className="space-y-1 text-sm">
            {sf.hours && <p className="olv-ink-soft">Horarios: {sf.hours}</p>}
            {sf.shipping && <p className="olv-ink-soft">Envíos: {sf.shipping}</p>}
            {(sf.payments ?? []).length > 0 && <p className="olv-ink-soft">Pagos: {sf.payments!.join(", ")}</p>}
            {sf.instagram && <p className="olv-ink-soft">Instagram: {sf.instagram}</p>}
          </div>
          <a href={createStorefrontContactUrl(store, slug)} target="_blank" rel="noreferrer" className="inline-block mt-3">
            <Button variant="success">Escríbeme por WhatsApp</Button>
          </a>
          <ContactFallback store={store} />
        </Section>
      </div>
    </StoreChrome>
  );
}

function ProductGrid({
  products,
  slug,
}: {
  products: PublicProductSummary[];
  slug: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map((p) => (
        <ProductCard key={p.productSlug} p={p} slug={slug} />
      ))}
    </div>
  );
}

// Card = link (navigation) + sibling add action. The action is never nested
// inside the link: the link keeps middle-click/copy-link, the button keeps the tap.
function ProductCard({ p, slug }: { p: PublicProductSummary; slug: string }) {
  const { add, lines, setQty, store } = useCartContext();
  const soldOut = p.availability === "sold_out";
  const quantity = lines.find((line) => line.productSlug === p.productSlug)?.qty ?? 0;
  return (
    <div className="group">
      <StorefrontLink to={`/catalogo/${slug}/producto/${p.productSlug}`} className="block">
        <div className="relative aspect-square rounded-xl overflow-hidden bg-[var(--olv-rule)]">
          <ProductImage src={p.imageUrl ?? undefined} alt={p.name} size="full" />
          {soldOut && (
            <span className="absolute top-2 left-2 bg-white/80 text-[var(--olv-ink)] text-[10px] font-semibold px-2 py-0.5 rounded-full">
              Agotado
            </span>
          )}
          {p.isNew && !soldOut && (
            <span className="absolute top-2 left-2 bg-[var(--olv-accent)] text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
              Nuevo
            </span>
          )}
        </div>
        <h3 className="olv-display font-semibold text-[var(--olv-ink)] mt-2 text-sm leading-snug">{p.name}</h3>
        <PublicTierPrices store={store} product={p} />
      </StorefrontLink>
      <CartProductControl
        key={`${p.productSlug}-${quantity}`}
        productSlug={p.productSlug}
        productName={p.name}
        quantity={quantity}
        onAdd={() => add(cartItemFromPublicProduct(p))}
        onSetQty={setQty}
        full
        className="mt-2"
      />
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h2 className="olv-display text-2xl font-semibold mb-4">{title}</h2>}
      {children}
    </section>
  );
}

function CatChip({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={
        "rounded-full px-4 py-2.5 text-sm font-semibold transition-colors min-h-10 inline-flex items-center " +
        (active
          ? "bg-[var(--olv-accent)] text-white"
          : "bg-white/60 text-[var(--olv-ink)] hover:bg-white")
      }
    >
      {children}
    </a>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="rounded-lg bg-white/50 ring-1 ring-[var(--olv-rule)]">
      <summary className="flex items-center justify-between w-full px-4 py-3 text-left cursor-pointer">
        <span className="font-semibold text-[var(--olv-ink)]">{q}</span>
        <span className="olv-ink-soft">+</span>
      </summary>
      <p className="olv-ink-soft px-4 pb-3 text-sm whitespace-pre-line">{a}</p>
    </details>
  );
}

// --- Product detail view --------------------------------------------------

function ProductView({ slug, productSlug }: { slug: string; productSlug: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [data, setData] = useState<{
    product: PublicProductDetail;
    store: PublicStore;
    catalog: PublicCatalog;
  } | null>(null);
  const [activeImg, setActiveImg] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setActiveImg(0);
    loadPublicCatalog(slug)
      .then(async ({ store, catalog }) => ({
        ...(await loadPublicProduct(slug, productSlug, store)),
        catalog,
      }))
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err instanceof PublicCatalogNotFoundError || /producto/i.test(err.message) ? "notfound" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [slug, productSlug]);

  // SEO: unconditional, derived from possibly-null data.
  const seoProduct = data?.product;
  const seoImages = seoProduct?.images ?? [];
  useSeo({
    title: seoProduct ? `${seoProduct.name} · ${data!.store.name}` : "Store OS",
    description: seoProduct?.publicDescription ?? undefined,
    canonicalPath: `/catalogo/${slug}/producto/${productSlug}`,
    ogImageUrl: seoImages[0]?.url ?? undefined,
    jsonLd: seoProduct
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: seoProduct.name,
          description: seoProduct.publicDescription ?? undefined,
          image: seoImages.map((i) => i.url),
          url: `${window.location.origin}/catalogo/${slug}/producto/${productSlug}`,
          ...(typeof publicPrice(seoProduct) === "number"
            ? {
                offers: {
                  "@type": "Offer",
                  price: String(publicPrice(seoProduct)),
                  priceCurrency: "MXN",
                  availability:
                    seoProduct.availability === "sold_out"
                      ? "https://schema.org/OutOfStock"
                      : "https://schema.org/InStock",
                },
              }
            : {}),
        }
      : undefined,
  });

  if (status === "loading") {
    return (
      <StoreChrome>
        <div className="mx-auto max-w-4xl p-4">
          <SkeletonCard />
        </div>
      </StoreChrome>
    );
  }
  if (status !== "ready" || !data) {
    return (
      <StoreChrome>
        <Centered>
          <EmptyState
            title="Pieza no encontrada"
            subtitle="Tal vez se retiró del catálogo."
            action={<Button variant="secondary" onClick={() => navigate(`/catalogo/${slug}`)}>Volver al catálogo</Button>}
          />
        </Centered>
      </StoreChrome>
    );
  }

  const { product, store, catalog } = data;
  const signalBySlug = Object.fromEntries(
    catalog.products.map((p) => [p.productSlug, p.stockSignal ?? "disponible"])
  );

  return (
    <StoreChrome
      store={store}
      signalBySlug={signalBySlug}
      visibleSlugs={new Set(catalog.products.map((p) => p.productSlug))}
      cartItems={catalog.products.map(cartItemFromPublicProduct)}
    >
      <ProductDetail product={product} store={store} slug={slug} activeImg={activeImg} setActiveImg={setActiveImg} />
    </StoreChrome>
  );
}

// Detail content lives under the chrome's cart provider so "Agregar" and the
// floating button share state.
function ProductDetail({
  product,
  store,
  slug,
  activeImg,
  setActiveImg,
}: {
  product: PublicProductDetail;
  store: PublicStore;
  slug: string;
  activeImg: number;
  setActiveImg: (i: number) => void;
}) {
  const { add, lines, setQty } = useCartContext();
  const images = product.images ?? [];
  const soldOut = product.availability === "sold_out";
  const canInquire = product.canInquire || !soldOut;
  const quantity = lines.find((line) => line.productSlug === product.productSlug)?.qty ?? 0;

  const buyUrl = useMemo(() => {
    return createStorefrontBuyUrl(store, slug, {
      name: product.name,
      sku: product.sku,
      productSlug: product.productSlug,
      intent: soldOut ? "inquire" : "buy",
    });
  }, [store, slug, product, soldOut]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
        <Button variant="ghost" onClick={() => navigate(`/catalogo/${slug}`)} className="olv-ink-soft text-sm p-0 min-h-10">
          ← Volver al catálogo
        </Button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {/* Gallery */}
          <div>
            <div className="aspect-square rounded-xl overflow-hidden bg-[var(--olv-rule)]">
              <ProductImage src={images[activeImg]?.url} alt={images[activeImg]?.alt || product.name} size="full" />
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 mt-2">
                {images.map((img, i) => (
                  <Button
                    key={i}
                    onClick={() => setActiveImg(i)}
                    aria-label={`Ver foto ${i + 1}`}
                    variant="ghost"
                    className={
                      "w-16 h-16 p-0 rounded-lg overflow-hidden ring-2 " +
                      (i === activeImg ? "ring-[var(--olv-accent)]" : "ring-transparent")
                    }
                  >
                    <ProductImage src={img.url} alt={img.alt || ""} size="thumb" />
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            <h1 className="olv-display text-3xl font-semibold">{product.name}</h1>
            <PublicTierPrices store={store} product={product} mode="detail" />

            {soldOut && (
              <p className="mt-2 inline-block bg-white/70 px-3 py-1 rounded-full text-sm font-semibold">Agotado</p>
            )}

            {product.publicDescription && (
              <p className="olv-ink-soft mt-4 whitespace-pre-line">{product.publicDescription}</p>
            )}

            <dl className="mt-4 space-y-1 text-sm">
              {product.material && <Detail label="Material" value={product.material} />}
              {product.finish && <Detail label="Acabado" value={product.finish} />}
              {product.dimensions && <Detail label="Medidas" value={product.dimensions} />}
              {product.care && <Detail label="Cuidados" value={product.care} />}
            </dl>

            {product.categories.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {product.categories.map((c) => (
                  <StorefrontLink
                    key={c.id}
                    to={`/catalogo/${slug}/categoria/${c.slug}`}
                    className="text-xs rounded-full bg-white/60 px-3 py-1 text-[var(--olv-ink)]"
                  >
                    {c.name}
                  </StorefrontLink>
                ))}
              </div>
            )}

            {/* CTAs: cart, buy/inquire (respects canInquire + sold-out), contact. */}
            <div className="mt-6 flex flex-col gap-2">
              <CartProductControl
                key={`${product.productSlug}-${quantity}`}
                productSlug={product.productSlug}
                productName={product.name}
                quantity={quantity}
                onAdd={() => add(cartItemFromPublicProduct({
                  ...product,
                  image: images[0]?.url,
                  inquire: soldOut,
                }))}
                onSetQty={setQty}
                full
                size="lg"
              />
              {canInquire && (
                <a href={buyUrl} target="_blank" rel="noreferrer">
                  <Button full size="lg" variant="primary" className="bg-[var(--olv-accent)] text-white hover:opacity-90">
                    {soldOut ? "Preguntar por esta pieza" : "Comprar por WhatsApp"}
                  </Button>
                </a>
              )}
              <a href={createStorefrontContactUrl(store, slug)} target="_blank" rel="noreferrer">
                <Button full variant="secondary">Contacto general</Button>
              </a>
              <ContactFallback store={store} />
              <p className="olv-ink-soft text-xs mt-1">
                Iniciar una conversación no reserva la pieza.
              </p>
            </div>
          </div>
        </div>
      </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="olv-ink-soft w-20 shrink-0">{label}</dt>
      <dd className="text-[var(--olv-ink)]">{value}</dd>
    </div>
  );
}

// --- Shared chrome --------------------------------------------------------

// Anchor that keeps its href (middle-click, copy link) while navigating in-app.
function StorefrontLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

function StoreChrome({
  store,
  signalBySlug,
  visibleSlugs,
  cartItems,
  children,
}: {
  store?: PublicStore;
  signalBySlug?: Record<string, PublicStockSignal>;
  visibleSlugs?: Set<string>;
  cartItems?: Omit<CartLine, "qty">[];
  children: React.ReactNode;
}) {
  // Hooks run unconditionally; the cart is inert (empty) without a store.
  const cart = useCart(store?.slug);
  const [cartOpen, setCartOpen] = useState(false);
  useEffect(() => {
    if (store && visibleSlugs) cart.prune(visibleSlugs);
  }, [cart.prune, store, visibleSlugs]);
  useEffect(() => {
    if (store && cartItems) cart.refresh(cartItems);
  }, [cart.refresh, cartItems, store]);
  const visibleLines = visibleSlugs ? pruneCartLines(cart.lines, visibleSlugs) : cart.lines;
  const pieces = cartPieces(visibleLines);

  const body = (
    <>
      {store && (
        <header className="sticky top-0 z-10 backdrop-blur bg-[var(--olv-bg)]/85 border-b border-[var(--olv-rule)]">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <StorefrontLink to={`/catalogo/${store.slug}`} className="olv-display text-xl font-semibold">
              {store.name}
            </StorefrontLink>
          </div>
        </header>
      )}
      {children}
      <footer className="border-t border-[var(--olv-rule)] mt-8 py-6 text-center text-xs">
        <p className="olv-ink-soft">© {store?.name}</p>
      </footer>
    </>
  );

  if (!store) {
    return (
      <div className="olivia-root min-h-full">
        <BrandStyle />
        {body}
      </div>
    );
  }

  return (
    <CartContext.Provider
      value={{ store, ...cart, lines: visibleLines, signalBySlug, open: cartOpen, setOpen: setCartOpen }}
    >
      <div className="olivia-root min-h-full">
        <BrandStyle />
        {body}
        {!cartOpen && (
          <CartFloatingButton
            pieces={pieces}
            onClick={() => setCartOpen(true)}
            className="rounded-full bg-[var(--olv-accent)] text-white hover:opacity-90 px-5"
          />
        )}
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
    </CartContext.Provider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[60vh] flex items-center justify-center p-6">{children}</div>;
}
