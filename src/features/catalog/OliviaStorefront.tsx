import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Scoped editorial styles travel with the storefront chunk, not the shared barrel.
import "../../design-system/olivia.css";
import { Button, Badge, EmptyState, SkeletonCard, ProductImage, ProductGallery, TextField, SelectField, OLIVIA_BRAND, useToast } from "../../design-system";
import { loadPublicStore, loadPublicCatalogSummary, loadPublicProduct, PublicCatalogNotFoundError, type PublicStore, type PublicCatalog, type PublicProductSummary, type PublicProductDetail } from "../../app/firebase/publicCatalog";
import { navigate, type RouteMatch } from "../../lib/router";
import { publicPrice } from "../../lib/money";
import { createStorefrontBuyUrl, createStorefrontContactUrl, createStorefrontResaleUrl } from "../../lib/whatsapp";
import { OLIVIA_CONTENT } from "../../lib/oliviaContent";
import { useSeo } from "./useSeo";
import { useCart } from "./useCart";
import { CartDrawer, CartFloatingButton, CartProductControl, PublicTierPrices } from "./CartDrawer";
import { cartItemFromPublicProduct, cartPieces, pruneCartLines } from "../../lib/cart";
import type { Storefront, StorefrontSection } from "../../types";
import { InlineEditable, InlineFaqEditor } from "./InlineEditable";

type CartContextValue = ReturnType<typeof useCart> & { store: PublicStore; notifyAdded: (name: string) => void };
const CartContext = createContext<CartContextValue | null>(null);
function useCartContext() { return useContext(CartContext)!; }
const OLIVIA_LOGO_URL = "/images/olivia-logo.png";

function isSoldOut(product: Pick<PublicProductSummary, "availability" | "stockSignal">) {
  return product.availability === "sold_out" || product.stockSignal === "agotado";
}

// Keep the catalog alive across category/product routes: two reads per visit,
// then only the detail document when opening a piece. No global/stale cache.
export function OliviaStorefront({ route, editor }: { route: RouteMatch; editor?: { storeId: string; storefront: Storefront; save: (storeId: string, storefront: Storefront) => Promise<void> } }) {
  const slug = "slug" in route.params ? route.params.slug : "";
  const toast = useToast();
  const [store, setStore] = useState<PublicStore | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Storefront>({});
  const [saving, setSaving] = useState(false);
  const canEdit = route.name === "public_store" && slug === "olivia" && !!editor;

  useEffect(() => {
    if (!editing) setDraft(editor?.storefront ?? {});
  }, [editing, editor?.storeId, editor?.storefront]);

  useEffect(() => {
    if (route.name !== "public_store") setEditing(false);
  }, [route.name]);

  function patchStorefront<K extends keyof Storefront>(key: K, value: Storefront[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function patchSection(key: "hero" | "story" | "resale", value: Partial<StorefrontSection>) {
    setDraft((current) => ({ ...current, [key]: { ...current[key], ...value } }));
  }

  async function saveDraft() {
    if (!editor || saving) return;
    setSaving(true);
    try {
      await editor.save(editor.storeId, draft);
      setStore((current) => current ? { ...current, storefront: draft } : current);
      setEditing(false);
      toast.success("Sitio público actualizado");
    } catch {
      toast.error("No se pudo guardar. Tus cambios siguen aquí; intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    setStore(null); setCatalog(null); setError(null);
    // Progressive load: the hero paints from the tiny store doc while the big
    // catalog doc (every product summary) is still in flight — the page's
    // largest element never waits for the grid's data.
    loadPublicStore(slug)
      .then((next) => { if (!cancelled) setStore(next); })
      .catch((err) => { if (!cancelled) setError(err instanceof PublicCatalogNotFoundError ? "missing" : "failed"); });
    loadPublicCatalogSummary(slug)
      .then((next) => { if (!cancelled) setCatalog(next); })
      .catch(() => { if (!cancelled) setError("failed"); });
    return () => { cancelled = true; };
  }, [slug]);
  useEffect(() => { document.documentElement.scrollTop = 0; }, [route]);
  const current = store?.slug === slug ? store : null;
  const editorActive = canEdit && editing;
  const viewStore = current && editorActive ? { ...current, storefront: draft } : current;
  return <>
    <StoreChrome store={viewStore} catalog={catalog} isHomeRoute={route.name === "public_store"} editing={editorActive} patchStorefront={patchStorefront}>
    {error ? <div className="olv-container olv-empty"><EmptyState title={error === "missing" ? "Tienda no encontrada" : "No se pudo cargar"} subtitle={error === "missing" ? "Este catálogo no existe o no está disponible." : "Revisa tu conexión e intenta de nuevo."} /></div>
      : !current ? <div className="olv-container olv-grid olv-loading">{Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}</div>
      : route.name === "public_product" ? <ProductView key={`${slug}/${route.params.productSlug}`} initialStore={current} productSlug={route.params.productSlug} />
      : <StoreView key={slug} store={viewStore!} catalog={catalog} focusCategory={route.name === "public_category" ? route.params.categorySlug : undefined} editing={editorActive} patchStorefront={patchStorefront} patchSection={patchSection} />}
    </StoreChrome>
    {canEdit && !editing && <Button className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 shadow-lg" onClick={() => { setDraft(editor?.storefront ?? {}); setEditing(true); }}>Editar sitio</Button>}
    {canEdit && editing && <div className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-surface p-3 text-on-surface shadow-md">
      <span className="text-sm font-medium">Estás editando tu sitio público</span>
      <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(editor?.storefront ?? {}); setEditing(false); }}>Salir sin guardar</Button><Button size="sm" disabled={saving} onClick={() => void saveDraft()}>{saving ? "Guardando…" : "Guardar"}</Button></div>
    </div>}
  </>;
}

function StoreView({ store, catalog, focusCategory, editing, patchStorefront, patchSection }: { store: PublicStore; catalog: PublicCatalog | null; focusCategory?: string; editing: boolean; patchStorefront: <K extends keyof Storefront>(key: K, value: Storefront[K]) => void; patchSection: (key: "hero" | "story" | "resale", value: Partial<StorefrontSection>) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const sf = store.storefront ?? {};
  const heroBody = sf.hero?.body ?? OLIVIA_CONTENT.hero!.body;
  const slug = store.slug;
  const priceLabel = store.priceTiers?.find((tier) => tier.id === store.defaultTierId)?.label || "Precio";
  const category = catalog?.categories.find((item) => item.slug === focusCategory);
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
    return (catalog?.products ?? []).filter((p) =>
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

  if (focusCategory && catalog && !category) return <div className="olv-container olv-empty"><EmptyState title="Categoría no encontrada" subtitle="Explora las demás piezas de Olivia." /><StorefrontLink to={`/catalogo/${slug}`} className="olv-link-button">Ver catálogo</StorefrontLink></div>;
  return <>
    {!focusCategory && <section className="olv-hero">
      {(sf.hero?.imageUrl || sf.hero?.mobileImageUrl) ? <picture className="olv-banner">
        {sf.hero.mobileImageUrl && <source media="(max-width: 639px)" srcSet={sf.hero.mobileImageUrl} />}
        <ProductImage src={sf.hero.imageUrl || sf.hero.mobileImageUrl} alt={sf.hero.imageAlt || `Colección de ${store.name}`} size="full" natural loading="eager" fetchPriority="high" width={sf.hero.imageWidth} height={sf.hero.imageHeight} />
      </picture> : null}
      <div className="olv-container olv-hero-copy">
        <p className="olv-eyebrow">Pequeños detalles. Muy tú.</p>
        <InlineEditable enabled={editing} label="Título principal" value={sf.hero?.heading ?? ""} displayValue={sf.hero?.heading?.trim().toLocaleLowerCase() === store.name.trim().toLocaleLowerCase() ? OLIVIA_CONTENT.hero!.heading : sf.hero?.heading || OLIVIA_CONTENT.hero!.heading} placeholder="Toca para añadir un título" render={(text) => <h1>{text}</h1>} onChange={(value) => patchSection("hero", { heading: value || undefined })} />
        <InlineEditable enabled={editing} label="Mensaje principal" value={sf.hero?.body ?? ""} displayValue={heroBody} placeholder="Toca para añadir un mensaje" multiline render={(text) => text ? <p className="olv-intro">{text}</p> : null} onChange={(value) => patchSection("hero", { body: value || undefined })} />
        <a href="#piezas" className="olv-link-button">Explorar piezas <span aria-hidden="true">↗</span></a>
        <InlineEditable enabled={editing} label="Beneficios" value={(sf.benefits ?? []).join("\n")} displayValue={(sf.benefits ?? []).join("\n")} placeholder="Toca para añadir beneficios, uno por línea" multiline render={(text) => text.trim() ? <div className="olv-benefits">{text.split(/\r?\n/).filter(Boolean).map((item) => <span key={item}>{item}</span>)}</div> : null} onChange={(value) => patchStorefront("benefits", value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))} />
      </div>
    </section>}
    <main id="piezas" className="olv-container olv-main">
      <div className="olv-section-heading"><div><p className="olv-eyebrow">Elige lo que va contigo</p><h2>{category?.name || "Encuentra tus favoritas"}</h2></div><p className="olv-muted">{products.length} {products.length === 1 ? "pieza" : "piezas"}</p></div>
      {category?.description && <p className="olv-muted">{category.description}</p>}
      <nav aria-label="Categorías" className="olv-categories">
        <StorefrontLink to={`/catalogo/${slug}`} current={!focusCategory}>Todas las piezas</StorefrontLink>
        {(catalog?.categories ?? []).map((c) => <StorefrontLink key={c.id} to={`/catalogo/${slug}/categoria/${c.slug}`} current={c.slug === focusCategory}>{c.name}</StorefrontLink>)}
      </nav>
      <div className="olv-tools">
        <TextField label="Buscar una pieza" type="search" placeholder="Nombre o clave de la pieza" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SelectField label="Ordenar por" value={sort} onChange={setSort} options={[{ value: "featured", label: "Destacados" }, { value: "new", label: "Novedades" }, { value: "price-asc", label: `${priceLabel}: menor a mayor` }, { value: "price-desc", label: `${priceLabel}: mayor a menor` }]} />
      </div>
      {products.length ? <div className="olv-grid">{products.map((p) => <ProductCard key={p.productSlug} p={p} slug={slug} />)}</div>
        : <div className="olv-empty"><EmptyState title={query ? "No encontramos esa pieza" : "Sin piezas aquí"} subtitle={query ? "Prueba otro nombre o clave." : "Vuelve pronto o explora otra categoría."} />{query && <Button variant="secondary" onClick={() => setQuery("")}>Limpiar búsqueda</Button>}</div>}
      <section className="olv-how" aria-labelledby="how-title"><div><p className="olv-eyebrow">Así de sencillo</p><h2 id="how-title">De tu lista a WhatsApp.</h2></div><div className="olv-steps"><p><span>01</span> Elige tus piezas</p><p><span>02</span> Revisa tu lista</p><p><span>03</span> Envíala por WhatsApp</p></div><p className="olv-muted">Fer confirma contigo el precio y la disponibilidad. Tu selección no reserva las piezas.</p></section>
      {!focusCategory && <div className="olv-about-grid">
        <section><p className="olv-eyebrow">Un poquito de nosotros</p>
          <InlineEditable enabled={editing} label="Título de historia" value={sf.story?.heading ?? ""} displayValue={sf.story?.heading || OLIVIA_CONTENT.story!.heading} placeholder="Toca para añadir un título" render={(text) => <h2>{text}</h2>} onChange={(value) => patchSection("story", { heading: value || undefined })} />
          <InlineEditable enabled={editing} label="Historia" value={sf.story?.body ?? ""} displayValue={sf.story?.body || OLIVIA_CONTENT.story!.body} placeholder="Toca para añadir la historia" multiline render={(text) => <p className="olv-body-copy">{text}</p>} onChange={(value) => patchSection("story", { body: value || undefined })} />
          {(sf.resale?.body || editing) && <div className="olv-resale">
            <InlineEditable enabled={editing} label="Título para revendedoras" value={sf.resale?.heading ?? ""} displayValue={sf.resale?.heading || "Vende con Olivia"} placeholder="Toca para añadir un título" render={(text) => <h3>{text}</h3>} onChange={(value) => patchSection("resale", { heading: value || undefined })} />
            <InlineEditable enabled={editing} label="Información para revendedoras" value={sf.resale?.body ?? ""} placeholder="Toca para añadir información" multiline render={(text) => text ? <p className="olv-body-copy">{text}</p> : null} onChange={(value) => patchSection("resale", { body: value || undefined })} />
            {!editing && <a className="olv-text-link" href={createStorefrontResaleUrl(store, slug)} target="_blank" rel="noreferrer">Quiero revender ↗</a>}
          </div>}
        </section>
        <section><h2>Antes de elegir</h2><InlineFaqEditor enabled={editing} value={editing ? sf.faq ?? [] : sf.faq ?? OLIVIA_CONTENT.faq!} onChange={(value) => patchStorefront("faq", value)} /></section>
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

function ProductView({ initialStore, productSlug }: { initialStore: PublicStore; productSlug: string }) {
  const [product, setProduct] = useState<PublicProductDetail | null>(null);
  const [store, setStore] = useState(initialStore);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadPublicProduct(initialStore.slug, productSlug, initialStore).then((next) => {
      if (!cancelled) { setProduct(next.product); setStore(next.store); }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [initialStore, productSlug]);
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

function StoreChrome({ store, catalog, children, isHomeRoute, editing, patchStorefront }: { store: PublicStore | null; catalog: PublicCatalog | null; children: ReactNode; isHomeRoute: boolean; editing: boolean; patchStorefront: <K extends keyof Storefront>(key: K, value: Storefront[K]) => void }) {
  const cart = useCart(store?.slug);
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
    if (!store || !catalog) return;
    cart.prune(new Set(catalog.products.map((p) => p.productSlug)));
    cart.refresh(catalog.products.map(cartItemFromPublicProduct));
  }, [cart.prune, cart.refresh, store, catalog]);
  const visibleSlugs = useMemo(() => catalog ? new Set(catalog.products.map((p) => p.productSlug)) : undefined, [catalog]);
  const lines = visibleSlugs ? pruneCartLines(cart.lines, visibleSlugs) : cart.lines;
  const pieces = cartPieces(lines);
  const sf = store?.storefront ?? {};
  const categories = catalog?.categories ?? [];
  const openCart = () => { setAddedName(null); setOpen(true); };
  const notifyAdded = (name: string) => setAddedName(name);
  const style = Object.fromEntries(Object.entries(OLIVIA_BRAND).filter(([key]) => !key.startsWith("font")).map(([key, value]) => [`--olv-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value]));
  const body = <div className="olivia-root" style={style}>
    {store && <>
      <InlineEditable enabled={editing} label="Aviso" value={sf.notice ?? ""} displayValue={sf.notice || "Tu próxima pieza favorita empieza aquí"} placeholder="Toca para añadir un aviso" render={(text) => <div className="olv-notice">{text}</div>} onChange={(value) => patchStorefront("notice", value || undefined)} />
      <header className={`olv-header${isHomeRoute ? " olv-header--home" : ""}${homeHeaderCompact ? " olv-header--compact" : ""}`}><div className={`olv-container olv-header-inner ${isHomeRoute ? "olv-header-inner--home" : ""}`}>
        <StorefrontLink to={`/catalogo/${store.slug}`} className="olv-wordmark">{sf.logoUrl ? <ProductImage src={sf.logoUrl} alt={`Logo de ${store.name}`} size="full" natural loading="eager" /> : <ProductImage src={OLIVIA_LOGO_URL} alt={`Logo de ${store.name}`} size="full" natural loading="eager" />}</StorefrontLink>
        <nav aria-label="Principal"><StorefrontLink to={`/catalogo/${store.slug}`} className="olv-header-catalog">Catálogo</StorefrontLink><Button variant="ghost" aria-label="Ver mi selección" onClick={openCart}>Mi pedido <span className="olv-count">{pieces}</span></Button></nav>
      </div></header>
    </>}
    {children}
    {store && <footer className="olv-footer"><div className="olv-container olv-footer-grid">
      <div><p className="olv-footer-brand">{store.name}</p><p>Pequeños detalles para hacerlos tuyos.</p><a className="olv-text-link" href={createStorefrontContactUrl(store, store.slug)} target="_blank" rel="noreferrer">Hablemos por WhatsApp ↗</a></div>
      <div><h2>Explora</h2><nav className="olv-footer-links" aria-label="Categorías del catálogo"><StorefrontLink to={`/catalogo/${store.slug}`}>Todas las piezas</StorefrontLink>{categories.map((category) => <StorefrontLink key={category.id} to={`/catalogo/${store.slug}/categoria/${category.slug}`}>{category.name}</StorefrontLink>)}</nav></div>
      <div><h2>Entregas y atención</h2>
        <InlineEditable enabled={editing} label="Entregas y envíos" value={sf.shipping ?? ""} displayValue={sf.shipping || OLIVIA_CONTENT.shipping} placeholder="Toca para añadir información de entregas" multiline render={(text) => <p>{text}</p>} onChange={(value) => patchStorefront("shipping", value || undefined)} />
        <InlineEditable enabled={editing} label="Horarios" value={sf.hours ?? ""} displayValue={sf.hours ?? ""} placeholder="Toca para añadir horarios" render={(text) => text ? <p>Horarios: {text}</p> : null} onChange={(value) => patchStorefront("hours", value || undefined)} />
        <InlineEditable enabled={editing} label="Métodos de pago" value={(sf.payments ?? []).join("\n")} displayValue={(sf.payments ?? []).join("\n")} placeholder="Toca para añadir métodos de pago, uno por línea" multiline render={(text) => text.trim() ? <p>Pagos: {text.split(/\r?\n/).filter(Boolean).join(", ")}</p> : null} onChange={(value) => patchStorefront("payments", value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))} />
        <InlineEditable enabled={editing} label="Instagram" value={sf.instagram ?? ""} displayValue={sf.instagram ?? ""} placeholder="Toca para añadir Instagram" render={(text) => text ? <p>Instagram: {text}</p> : null} onChange={(value) => patchStorefront("instagram", value || undefined)} />
      </div>
    </div><div className="olv-container olv-footer-bottom">© {store.name}<span>Elige. Combina. Hazlo tuyo.</span></div></footer>}
    {store && <>
      {addedName && !open && <div className="olv-added-status" role="status" aria-live="polite"><span><strong>Agregado a tu pedido</strong><span className="olv-added-name">{addedName}</span></span><Button variant="primary" onClick={openCart}>Ver mi pedido</Button></div>}
      <CartFloatingButton pieces={pieces} onClick={openCart} className={`olv-floating ${open ? "hidden" : ""}`} />
      {catalog && <CartDrawer open={open} onClose={() => setOpen(false)} store={store} lines={lines} signalBySlug={Object.fromEntries(catalog.products.map((p) => [p.productSlug, p.stockSignal ?? "disponible"]))} visibleSlugs={visibleSlugs} onSetQty={cart.setQty} />}
    </>}
  </div>;
  return store ? <CartContext.Provider value={{ ...cart, lines, store, notifyAdded }}>{body}</CartContext.Provider> : body;
}
