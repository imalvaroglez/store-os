import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Scoped editorial styles travel with the storefront chunk, not the shared barrel.
import "../../design-system/olivia.css";
import { Button, Badge, EmptyState, SkeletonCard, ProductImage, ProductGallery, TextField, SelectField, OLIVIA_BRAND } from "../../design-system";
import { loadPublicCatalog, loadPublicProduct, PublicCatalogNotFoundError, type PublicStore, type PublicCatalog, type PublicProductSummary, type PublicProductDetail } from "../../app/firebase/publicCatalog";
import { navigate, type RouteMatch } from "../../lib/router";
import { publicPrice } from "../../lib/money";
import { createStorefrontBuyUrl, createStorefrontContactUrl, createStorefrontResaleUrl } from "../../lib/whatsapp";
import { OLIVIA_CONTENT } from "../../lib/oliviaContent";
import { useSeo } from "./useSeo";
import { useCart } from "./useCart";
import { CartDrawer, CartFloatingButton, CartProductControl, PublicTierPrices } from "./CartDrawer";
import { cartItemFromPublicProduct, cartPieces, pruneCartLines } from "../../lib/cart";

type CatalogData = { store: PublicStore; catalog: PublicCatalog };
type CartContextValue = ReturnType<typeof useCart> & { store: PublicStore; notifyAdded: (name: string) => void };
const CartContext = createContext<CartContextValue | null>(null);
function useCartContext() { return useContext(CartContext)!; }
const OLIVIA_LOGO_URL = "/images/olivia-logo.png";

function isSoldOut(product: Pick<PublicProductSummary, "availability" | "stockSignal">) {
  return product.availability === "sold_out" || product.stockSignal === "agotado";
}

// Keep the catalog alive across category/product routes: two reads per visit,
// then only the detail document when opening a piece. No global/stale cache.
export function OliviaStorefront({ route }: { route: RouteMatch }) {
  const slug = "slug" in route.params ? route.params.slug : "";
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    loadPublicCatalog(slug).then((next) => { if (!cancelled) setData(next); })
      .catch((err) => { if (!cancelled) setError(err instanceof PublicCatalogNotFoundError ? "missing" : "failed"); });
    return () => { cancelled = true; };
  }, [slug]);
  useEffect(() => { document.documentElement.scrollTop = 0; }, [route]);
  const current = data?.store.slug === slug ? data : null;
  return <StoreChrome data={current} isHomeRoute={route.name === "public_store"}>
    {error ? <div className="olv-container olv-empty"><EmptyState title={error === "missing" ? "Tienda no encontrada" : "No se pudo cargar"} subtitle={error === "missing" ? "Este catálogo no existe o no está disponible." : "Revisa tu conexión e intenta de nuevo."} /></div>
      : !current ? <div className="olv-container olv-grid olv-loading">{Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}</div>
      : route.name === "public_product" ? <ProductView key={`${slug}/${route.params.productSlug}`} data={current} productSlug={route.params.productSlug} />
      : <StoreView key={slug} data={current} focusCategory={route.name === "public_category" ? route.params.categorySlug : undefined} />}
  </StoreChrome>;
}

function StoreView({ data: { store, catalog }, focusCategory }: { data: CatalogData; focusCategory?: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const sf = store.storefront ?? {};
  const slug = store.slug;
  const priceLabel = store.priceTiers?.find((tier) => tier.id === store.defaultTierId)?.label || "Precio";
  const category = catalog.categories.find((item) => item.slug === focusCategory);
  useEffect(() => { setQuery(""); }, [focusCategory]);
  useSeo({
    title: category ? `${category.name} · ${store.name}` : sf.seo?.title || `${store.name} — Joyería`,
    description: sf.seo?.description || sf.hero?.body || OLIVIA_CONTENT.hero?.body,
    canonicalPath: category ? `/catalogo/${slug}/categoria/${category.slug}` : `/catalogo/${slug}`,
    ogImageUrl: sf.seo?.ogImageUrl || sf.hero?.imageUrl,
    jsonLd: { "@context": "https://schema.org", "@type": "Store", name: store.name, url: `${window.location.origin}/catalogo/${slug}` },
  });
  const products = useMemo(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const needle = normalize(query.trim());
    return catalog.products.filter((p) =>
      ((sf.showSoldOut ?? true) || !isSoldOut(p)) &&
      (!category || p.categoryIds?.includes(category.id)) &&
      normalize(`${p.name} ${p.sku ?? ""}`).includes(needle)
    ).sort((a, b) => {
      if (sort === "price-asc" || sort === "price-desc") {
        const ap = publicPrice(a, store.defaultTierId ?? undefined), bp = publicPrice(b, store.defaultTierId ?? undefined);
        if (ap === undefined) return bp === undefined ? 0 : 1;
        if (bp === undefined) return -1;
        return sort === "price-asc" ? ap - bp : bp - ap;
      }
      const flag = sort === "new" ? "isNew" : "isFeatured";
      return Number(Boolean(b[flag])) - Number(Boolean(a[flag])) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  }, [catalog, category, query, sort, sf.showSoldOut, store.defaultTierId]);

  if (focusCategory && !category) return <div className="olv-container olv-empty"><EmptyState title="Categoría no encontrada" subtitle="Explora las demás piezas de Olivia." /><StorefrontLink to={`/catalogo/${slug}`} className="olv-link-button">Ver catálogo</StorefrontLink></div>;
  return <>
    {!focusCategory && <section className="olv-hero">
      {(sf.hero?.imageUrl || sf.hero?.mobileImageUrl) ? <picture className="olv-banner">
        {sf.hero.mobileImageUrl && <source media="(max-width: 639px)" srcSet={sf.hero.mobileImageUrl} />}
        <ProductImage src={sf.hero.imageUrl || sf.hero.mobileImageUrl} alt={sf.hero.imageAlt || `Colección de ${store.name}`} size="full" natural loading="eager" fetchPriority="high" width={sf.hero.imageWidth} height={sf.hero.imageHeight} />
      </picture> : null}
      <div className="olv-container olv-hero-copy">
        <p className="olv-eyebrow">Pequeños detalles. Muy tú.</p>
        <h1>{sf.hero?.heading?.trim().toLocaleLowerCase() === store.name.trim().toLocaleLowerCase() ? OLIVIA_CONTENT.hero!.heading : sf.hero?.heading || OLIVIA_CONTENT.hero!.heading}</h1>
        <p className="olv-intro">{sf.hero?.body || OLIVIA_CONTENT.hero!.body}</p>
        <a href="#piezas" className="olv-link-button">Explorar piezas <span aria-hidden="true">↗</span></a>
        {!!sf.benefits?.length && <div className="olv-benefits">{sf.benefits.map((item) => <span key={item}>{item}</span>)}</div>}
      </div>
    </section>}
    <main id="piezas" className="olv-container olv-main">
      <div className="olv-section-heading"><div><p className="olv-eyebrow">Elige lo que va contigo</p><h2>{category?.name || "Encuentra tus favoritas"}</h2></div><p className="olv-muted">{products.length} {products.length === 1 ? "pieza" : "piezas"}</p></div>
      {category?.description && <p className="olv-muted">{category.description}</p>}
      <nav aria-label="Categorías" className="olv-categories">
        <StorefrontLink to={`/catalogo/${slug}`} current={!focusCategory}>Todas las piezas</StorefrontLink>
        {catalog.categories.map((c) => <StorefrontLink key={c.id} to={`/catalogo/${slug}/categoria/${c.slug}`} current={c.slug === focusCategory}>{c.name}</StorefrontLink>)}
      </nav>
      <div className="olv-tools">
        <TextField label="Buscar una pieza" type="search" placeholder="Nombre o clave de la pieza" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SelectField label="Ordenar por" value={sort} onChange={setSort} options={[{ value: "featured", label: "Destacados" }, { value: "new", label: "Novedades" }, { value: "price-asc", label: `${priceLabel}: menor a mayor` }, { value: "price-desc", label: `${priceLabel}: mayor a menor` }]} />
      </div>
      {products.length ? <div className="olv-grid">{products.map((p) => <ProductCard key={p.productSlug} p={p} slug={slug} />)}</div>
        : <div className="olv-empty"><EmptyState title={query ? "No encontramos esa pieza" : "Sin piezas aquí"} subtitle={query ? "Prueba otro nombre o clave." : "Vuelve pronto o explora otra categoría."} />{query && <Button variant="secondary" onClick={() => setQuery("")}>Limpiar búsqueda</Button>}</div>}
      <section className="olv-how" aria-labelledby="how-title"><div><p className="olv-eyebrow">Así de sencillo</p><h2 id="how-title">De tu lista a WhatsApp.</h2></div><div className="olv-steps"><p><span>01</span> Elige tus piezas</p><p><span>02</span> Revisa tu lista</p><p><span>03</span> Envíala por WhatsApp</p></div><p className="olv-muted">Fer confirma contigo el precio y la disponibilidad. Tu selección no reserva las piezas.</p></section>
      {!focusCategory && <div className="olv-about-grid">
        <section><p className="olv-eyebrow">Un poquito de nosotros</p><h2>{sf.story?.heading || OLIVIA_CONTENT.story!.heading}</h2><p className="olv-body-copy">{sf.story?.body || OLIVIA_CONTENT.story!.body}</p>
          {sf.resale?.body && <div className="olv-resale"><h3>{sf.resale.heading || "Vende con Olivia"}</h3><p className="olv-body-copy">{sf.resale.body}</p><a className="olv-text-link" href={createStorefrontResaleUrl(store, slug)} target="_blank" rel="noreferrer">Quiero revender ↗</a></div>}
        </section>
        <section><h2>Antes de elegir</h2><div className="olv-faq">{(sf.faq ?? OLIVIA_CONTENT.faq!).map((item, i) => <details key={i}><summary>{item.q}<span aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div></section>
      </div>}
    </main>
  </>;
}

function ProductCard({ p, slug }: { p: PublicProductSummary; slug: string }) {
  const { store, lines, add, setQty, notifyAdded } = useCartContext();
  const quantity = lines.find((line) => line.productSlug === p.productSlug)?.qty ?? 0;
  const href = `/catalogo/${slug}/producto/${p.productSlug}`;
  const images = p.images?.length ? p.images : p.imageUrl ? [{ url: p.imageUrl }] : [];
  const soldOut = isSoldOut(p);
  return <article className="olv-product" aria-label={p.name}>
    <ProductGallery images={images} name={p.name} href={href} onNavigate={() => navigate(href)} />
    <div className="olv-product-info">
      <div className="olv-product-labels">{soldOut ? <Badge tone="neutral">Agotado</Badge> : p.stockSignal === "pocas" ? <Badge tone="warning">Quedan pocas</Badge> : p.isNew ? <Badge>Nuevo</Badge> : p.isFeatured ? <span>Selección Olivia</span> : null}</div>
      <h3><StorefrontLink to={href}>{p.name}</StorefrontLink></h3>
      <PublicTierPrices store={store} product={p} />
    </div>
    <CartProductControl key={`${p.productSlug}-${quantity}`} productSlug={p.productSlug} productName={p.name} quantity={quantity} onAdd={() => { add(cartItemFromPublicProduct(p)); notifyAdded(p.name); }} onSetQty={setQty} full />
  </article>;
}

function ProductView({ data, productSlug }: { data: CatalogData; productSlug: string }) {
  const [product, setProduct] = useState<PublicProductDetail | null>(null);
  const [store, setStore] = useState(data.store);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadPublicProduct(data.store.slug, productSlug, data.store).then((next) => {
      if (!cancelled) { setProduct(next.product); setStore(next.store); }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [data.store, productSlug]);
  useSeo({
    title: product ? `${product.name} · ${store.name}` : store.name,
    description: product?.publicDescription ?? undefined,
    canonicalPath: `/catalogo/${store.slug}/producto/${productSlug}`,
    ogImageUrl: product?.images[0]?.url,
    jsonLd: product ? { "@context": "https://schema.org", "@type": "Product", name: product.name, description: product.publicDescription, image: product.images.map((i) => i.url), url: `${window.location.origin}/catalogo/${store.slug}/producto/${productSlug}`, ...(typeof publicPrice(product) === "number" ? { offers: { "@type": "Offer", price: String(publicPrice(product)), priceCurrency: "MXN", availability: isSoldOut(product) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" } } : {}) } : undefined,
  });
  if (failed) return <div className="olv-container olv-empty"><EmptyState title="No se pudo abrir la pieza" subtitle="Puede que ya no esté disponible. Revisa tu conexión o vuelve al catálogo." /><StorefrontLink to={`/catalogo/${store.slug}`} className="olv-link-button">Volver al catálogo</StorefrontLink></div>;
  if (!product) return <div className="olv-container olv-loading"><SkeletonCard /></div>;
  return <ProductDetail product={product} store={store} />;
}

function ProductDetail({ product, store }: { product: PublicProductDetail; store: PublicStore }) {
  const { add, lines, setQty, notifyAdded } = useCartContext();
  const quantity = lines.find((line) => line.productSlug === product.productSlug)?.qty ?? 0;
  const soldOut = isSoldOut(product);
  const images = [...product.images].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return <main className="olv-container olv-detail">
    <StorefrontLink className="olv-back" to={`/catalogo/${store.slug}`}>← Volver al catálogo</StorefrontLink>
    <div className="olv-detail-grid">
      <ProductGallery images={images} name={product.name} thumbnails />
      <div className="olv-detail-info"><p className="olv-eyebrow">Una pieza. Tu manera de llevarla.</p><h1>{product.name}</h1>
        <PublicTierPrices store={store} product={product} mode="detail" />
        {soldOut && <Badge tone="neutral">Agotado</Badge>}
        {product.publicDescription && <p className="olv-body-copy">{product.publicDescription}</p>}
        <dl className="olv-specs">{([["Material", product.material], ["Acabado", product.finish], ["Medidas", product.dimensions], ["Cuidados", product.care]] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="olv-detail-actions"><CartProductControl key={`${product.productSlug}-${quantity}`} productSlug={product.productSlug} productName={product.name} quantity={quantity} onAdd={() => { add(cartItemFromPublicProduct({ ...product, image: images[0]?.url, inquire: soldOut })); notifyAdded(product.name); }} onSetQty={setQty} full size="lg" />
          {(product.canInquire || !soldOut) && <a className="olv-text-link" target="_blank" rel="noreferrer" href={createStorefrontBuyUrl(store, store.slug, { name: product.name, productSlug: product.productSlug, intent: soldOut ? "inquire" : "buy" })}>{soldOut ? "Preguntar por esta pieza" : "Comprar por WhatsApp"} ↗</a>}
          <p className="olv-muted text-sm">Enviar tu selección no confirma ni reserva el pedido.</p>
        </div>
        <details className="olv-delivery" open><summary>Entregas y envíos</summary><p>{store.storefront?.shipping || OLIVIA_CONTENT.shipping}</p></details>
        {!!product.categories.length && <nav className="olv-categories" aria-label="Categorías de la pieza">{product.categories.map((c) => <StorefrontLink key={c.id} to={`/catalogo/${store.slug}/categoria/${c.slug}`}>{c.name}</StorefrontLink>)}</nav>}
      </div>
    </div>
  </main>;
}

function StorefrontLink({ to, className, children, current }: { to: string; className?: string; children: ReactNode; current?: boolean }) {
  return <a href={to} className={className} aria-current={current ? "page" : undefined} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(to);
  }}>{children}</a>;
}

function StoreChrome({ data, children, isHomeRoute }: { data: CatalogData | null; children: ReactNode; isHomeRoute: boolean }) {
  const cart = useCart(data?.store.slug);
  const [open, setOpen] = useState(false);
  const [addedName, setAddedName] = useState<string | null>(null);
  const [homeHeaderCompact, setHomeHeaderCompact] = useState(false);
  useEffect(() => {
    if (!isHomeRoute) {
      setHomeHeaderCompact(false);
      return;
    }
    const onScroll = () => setHomeHeaderCompact((compact) => {
      if (window.scrollY <= 4) return false;
      if (window.scrollY >= 96) return true;
      return compact;
    });
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHomeRoute]);
  useEffect(() => {
    if (!data) return;
    cart.prune(new Set(data.catalog.products.map((p) => p.productSlug)));
    cart.refresh(data.catalog.products.map(cartItemFromPublicProduct));
  }, [cart.prune, cart.refresh, data]);
  const visibleSlugs = useMemo(() => data ? new Set(data.catalog.products.map((p) => p.productSlug)) : undefined, [data]);
  const lines = visibleSlugs ? pruneCartLines(cart.lines, visibleSlugs) : cart.lines;
  const pieces = cartPieces(lines);
  const store = data?.store;
  const sf = store?.storefront ?? {};
  const categories = data?.catalog.categories ?? [];
  const openCart = () => { setAddedName(null); setOpen(true); };
  const notifyAdded = (name: string) => setAddedName(name);
  const style = Object.fromEntries(Object.entries(OLIVIA_BRAND).filter(([key]) => !key.startsWith("font")).map(([key, value]) => [`--olv-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value]));
  const body = <div className="olivia-root" style={style}>
    {store && <>
      <div className="olv-notice">{sf.notice || "Tu próxima pieza favorita empieza aquí"}</div>
      <header className={`olv-header${isHomeRoute ? " olv-header--home" : ""}${homeHeaderCompact ? " olv-header--compact" : ""}`}><div className={`olv-container olv-header-inner ${isHomeRoute ? "olv-header-inner--home" : ""}`}>
        <StorefrontLink to={`/catalogo/${store.slug}`} className="olv-wordmark">{sf.logoUrl ? <ProductImage src={sf.logoUrl} alt={`Logo de ${store.name}`} size="full" natural loading="eager" /> : <ProductImage src={OLIVIA_LOGO_URL} alt={`Logo de ${store.name}`} size="full" natural loading="eager" />}</StorefrontLink>
        <nav aria-label="Principal"><StorefrontLink to={`/catalogo/${store.slug}`} className="olv-header-catalog">Catálogo</StorefrontLink><Button variant="ghost" aria-label="Ver mi selección" onClick={openCart}>Mi pedido <span className="olv-count">{pieces}</span></Button></nav>
      </div></header>
    </>}
    {children}
    {store && <footer className="olv-footer"><div className="olv-container olv-footer-grid">
      <div><p className="olv-footer-brand">{store.name}</p><p>Pequeños detalles para hacerlos tuyos.</p><a className="olv-text-link" href={createStorefrontContactUrl(store, store.slug)} target="_blank" rel="noreferrer">Hablemos por WhatsApp ↗</a></div>
      <div><h2>Explora</h2><nav className="olv-footer-links" aria-label="Categorías del catálogo"><StorefrontLink to={`/catalogo/${store.slug}`}>Todas las piezas</StorefrontLink>{categories.map((category) => <StorefrontLink key={category.id} to={`/catalogo/${store.slug}/categoria/${category.slug}`}>{category.name}</StorefrontLink>)}</nav></div>
      <div><h2>Entregas y atención</h2><p>{sf.shipping || OLIVIA_CONTENT.shipping}</p>{sf.hours && <p>Horarios: {sf.hours}</p>}{!!sf.payments?.length && <p>Pagos: {sf.payments.join(", ")}</p>}{sf.instagram && <p>Instagram: {sf.instagram}</p>}</div>
    </div><div className="olv-container olv-footer-bottom">© {store.name}<span>Elige. Combina. Hazlo tuyo.</span></div></footer>}
    {store && <>
      {addedName && !open && <div className="olv-added-status" role="status" aria-live="polite"><span><strong>Agregado a tu pedido</strong><span className="olv-added-name">{addedName}</span></span><Button variant="primary" onClick={openCart}>Ver mi pedido</Button></div>}
      <CartFloatingButton pieces={pieces} onClick={openCart} className={`olv-floating ${open ? "hidden" : ""}`} />
      <CartDrawer open={open} onClose={() => setOpen(false)} store={store} lines={lines} signalBySlug={Object.fromEntries(data!.catalog.products.map((p) => [p.productSlug, p.stockSignal ?? "disponible"]))} visibleSlugs={visibleSlugs} onSetQty={cart.setQty} />
    </>}
  </div>;
  return store ? <CartContext.Provider value={{ ...cart, lines, store, notifyAdded }}>{body}</CartContext.Provider> : body;
}
