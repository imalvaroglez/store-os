import { useEffect, useRef, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { PublicCatalogProjectionError } from "../../app/firebase/firestoreData";
import {
  Button,
  FileButton,
  ProductImage,
  TextField,
  TextArea,
  CheckboxField,
  useToast,
} from "../../design-system";
import { resizeImageFile, uploadStorefrontImage, deleteStorefrontImage } from "../../app/firebase/storage";
import { OLIVIA_CONTENT } from "../../lib/oliviaContent";
import type { Store, Storefront, FAQItem } from "../../types";

// Structured storefront content editor for Fer: hero, benefits, story, resale,
// FAQ, notice, shipping, payments, hours, instagram, WhatsApp intros,
// and the show-sold-out toggle. No free-form page builder — fixed fields map to
// fixed sections of the public catalog. SEO fields included.
export function StorefrontEditor({
  store,
  onDone,
}: {
  store: Store;
  onDone: () => void;
}) {
  const { updateStore, cloud } = useStore();
  const toast = useToast();
  const [sf, setSf] = useState<Storefront>(store.storefront ?? {});
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pending, setPending] = useState<Partial<Record<ImageSlot, Blob>>>({});
  const previews = useRef<string[]>([]);
  const previousImages = useRef(imageUrls(store.storefront ?? {}));
  useEffect(() => () => previews.current.forEach(URL.revokeObjectURL), []);

  function setImage(content: Storefront, slot: ImageSlot, url: string): Storefront {
    return slot === "logo" ? { ...content, logoUrl: url } : {
      ...content, hero: { ...content.hero, [slot === "desktop" ? "imageUrl" : "mobileImageUrl"]: url },
    };
  }
  async function selectImage(slot: ImageSlot, file: File) {
    setProcessing(true);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        throw new Error("Elige una imagen JPG, PNG o WebP de hasta 10 MB.");
      }
      const blob = await resizeImageFile(file, { transparent: slot === "logo", maxEdge: slot === "logo" ? 600 : 1600 });
      if (blob.size > 500 * 1024) throw new Error("La imagen tiene demasiado detalle. Prueba una versión más ligera (hasta 500 KB después de optimizar).");
      const url = URL.createObjectURL(blob);
      previews.current.push(url);
      setPending((previous) => ({ ...previous, [slot]: blob }));
      setSf((previous) => setImage(previous, slot, url));
    } catch (error) { toast.error((error as Error).message); }
    finally { setProcessing(false); }
  }
  function removeImage(slot: ImageSlot) {
    setPending((previous) => { const next = { ...previous }; delete next[slot]; return next; });
    setSf((previous) => setImage(previous, slot, ""));
  }

  function patch(next: Partial<Storefront>) {
    setSf((prev) => ({ ...prev, ...next }));
  }
  function patchSection<K extends keyof Storefront>(
    key: K,
    field: "heading" | "body" | "imageUrl" | "imageAlt",
    value: string
  ) {
    setSf((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as object | undefined), [field]: value },
    }));
  }

  async function save() {
    setBusy(true);
    let next = sf;
    const uploaded: string[] = [];
    try {
      for (const [slot, blob] of Object.entries(pending) as [ImageSlot, Blob][]) {
        const url = cloud ? await uploadStorefrontImage(store.id, blob) : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("No se pudo guardar la imagen."));
          reader.readAsDataURL(blob);
        });
        uploaded.push(url);
        next = setImage(next, slot, url);
      }
    } catch {
      if (cloud) await Promise.allSettled(uploaded.map((url) => deleteStorefrontImage(store.id, url)));
      toast.error("No se pudo subir la imagen. Tu sitio anterior sigue disponible. Intenta de nuevo.");
      setBusy(false);
      return;
    }
    // Keep uploaded URLs on a failed/uncertain save: retry without uploading again.
    // ponytail: uncertain writes retain files; reconcile storage if failed saves accumulate.
    setSf(next);
    setPending({});
    try {
      await updateStore({ id: store.id, storefront: next });
      if (cloud) {
        const active = new Set(imageUrls(next));
        const removed = await Promise.allSettled(previousImages.current.filter((url) => !active.has(url)).map((url) => deleteStorefrontImage(store.id, url)));
        if (removed.some((result) => result.status === "rejected")) toast.error("El sitio se actualizó, pero no se pudo limpiar una imagen anterior.");
      }
      previousImages.current = imageUrls(next);
      toast.success("Sitio público actualizado");
      onDone();
    } catch (error) {
      toast.error(error instanceof PublicCatalogProjectionError
        ? "El sitio se guardó, pero no se pudo actualizar el catálogo público. Guarda de nuevo para reintentar. Tus imágenes se conservaron."
        : "No se pudo guardar. Tus cambios siguen aquí; intenta de nuevo.");
    } finally { setBusy(false); }
  }

  return (
    <fieldset disabled={busy || processing} className="space-y-5 min-w-0">
      {store.slug === "olivia" && <Section title="Textos sugeridos para Olivia">
        <p className="text-sm text-on-surface-soft">Carga una propuesta para presentación, historia, entregas y preguntas. Revisa los cambios antes de guardar; las imágenes se conservan.</p>
        <Button variant="secondary" onClick={() => setSf((previous) => ({ ...previous, ...OLIVIA_CONTENT, hero: { ...previous.hero, ...OLIVIA_CONTENT.hero } }))}>Usar textos sugeridos</Button>
      </Section>}
      <Section title="Imágenes de tu marca">
        <p className="text-sm text-on-surface-soft">Logo separado de la portada. La portada conserva su proporción; el texto aparece debajo. JPG, PNG o WebP, hasta 10 MB. Los cambios se publican al guardar.</p>
        {(["logo", "desktop", "mobile"] as const).map((slot) => {
          const label = slot === "logo" ? "Logo" : slot === "desktop" ? "Portada de escritorio" : "Portada de celular";
          const url = slot === "logo" ? sf.logoUrl : slot === "desktop" ? sf.hero?.imageUrl : sf.hero?.mobileImageUrl;
          return <div key={slot} className="space-y-2 rounded-lg border border-edge p-3">
            <h4 className="text-sm font-semibold">{label}</h4>
            {url && <div className={slot === "logo" ? "max-w-48" : "max-w-xl"}><ProductImage src={url} alt={`Vista previa: ${label}`} size="full" natural loading="eager" /></div>}
            <div className="flex flex-wrap gap-2"><FileButton label={`${url ? "Cambiar" : "Subir"} ${label.toLowerCase()}`} accept="image/jpeg,image/png,image/webp" disabled={busy || processing} onSelect={(file) => void selectImage(slot, file)} />
            {url && <Button variant="ghost" onClick={() => removeImage(slot)}>Quitar {label.toLowerCase()}</Button>}</div>
          </div>;
        })}
        <TextField label="Descripción de la portada" hint="Describe lo que aparece en la imagen para quienes usan lector de pantalla." value={sf.hero?.imageAlt ?? ""} onChange={(e) => patchSection("hero", "imageAlt", e.target.value)} />
        <p className="text-xs text-on-surface-soft">Sin portada de celular se muestra la de escritorio. Sin imágenes, se muestra el nombre y la presentación de la tienda.</p>
      </Section>
      <Section title="Presentación">
        <TextField
          label="Título principal"
          placeholder="Olivia"
          value={sf.hero?.heading ?? ""}
          onChange={(e) => patchSection("hero", "heading", e.target.value)}
        />
        <TextArea
          label="Mensaje principal"
          placeholder="Encuentra esa pieza que va contigo…"
          value={sf.hero?.body ?? ""}
          onChange={(e) => patchSection("hero", "body", e.target.value)}
        />
        <TextArea
          label="Beneficios (uno por línea)"
          hint="Aparecen bajo la presentación."
          placeholder={"Describe solo beneficios confirmados de tu tienda"}
          value={(sf.benefits ?? []).join("\n")}
          onChange={(e) => patch({ benefits: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
        />
      </Section>

      <Section title="Nuestra historia">
        <TextField
          label="Título"
          value={sf.story?.heading ?? ""}
          onChange={(e) => patchSection("story", "heading", e.target.value)}
        />
        <TextArea
          label="Texto"
          value={sf.story?.body ?? ""}
          onChange={(e) => patchSection("story", "body", e.target.value)}
        />
      </Section>

      <Section title="Vende con Olivia (reventa)">
        <TextField
          label="Título"
          value={sf.resale?.heading ?? ""}
          onChange={(e) => patchSection("resale", "heading", e.target.value)}
        />
        <TextArea
          label="Texto"
          value={sf.resale?.body ?? ""}
          onChange={(e) => patchSection("resale", "body", e.target.value)}
        />
      </Section>

      <Section title="Preguntas frecuentes">
        <FAQEditor items={sf.faq ?? []} onChange={(faq) => patch({ faq })} />
      </Section>

      <Section title="Información de la tienda">
        <TextField
          label="Aviso general"
          placeholder="Mensaje breve tipo banner"
          value={sf.notice ?? ""}
          onChange={(e) => patch({ notice: e.target.value })}
        />
        <TextArea
          label="Entregas y envíos"
          value={sf.shipping ?? ""}
          onChange={(e) => patch({ shipping: e.target.value })}
        />
        <TextArea
          label="Métodos de pago (uno por línea)"
          placeholder={"Transferencia\nEfectivo"}
          value={(sf.payments ?? []).join("\n")}
          onChange={(e) => patch({ payments: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
        />
        <TextField
          label="Horarios"
          value={sf.hours ?? ""}
          onChange={(e) => patch({ hours: e.target.value })}
        />
        <TextField
          label="Instagram (usuario o enlace)"
          placeholder="@olivia"
          value={sf.instagram ?? ""}
          onChange={(e) => patch({ instagram: e.target.value })}
        />
      </Section>

      <Section title="Mensajes de WhatsApp">
        <TextField
          label="Mensaje al comprar (introducción)"
          hint="Se completa solo con nombre, clave y enlace. No lo borres."
          value={sf.whatsappBuyIntro ?? ""}
          onChange={(e) => patch({ whatsappBuyIntro: e.target.value })}
        />
        <TextField
          label="Mensaje de reventa (introducción)"
          value={sf.whatsappResaleIntro ?? ""}
          onChange={(e) => patch({ whatsappResaleIntro: e.target.value })}
        />
        <CheckboxField
          label="Mostrar productos agotados en el catálogo"
          checked={sf.showSoldOut ?? false}
          onChange={(v) => patch({ showSoldOut: v })}
          caption={sf.showSoldOut ? "Visibles" : "Ocultos"}
        />
      </Section>

      <Section title="SEO">
        <TextField
          label="Título para buscadores"
          value={sf.seo?.title ?? ""}
          onChange={(e) => patch({ seo: { ...sf.seo, title: e.target.value } })}
        />
        <TextArea
          label="Descripción para buscadores"
          value={sf.seo?.description ?? ""}
          onChange={(e) => patch({ seo: { ...sf.seo, description: e.target.value } })}
        />
        <TextField
          label="Imagen para compartir (URL)"
          value={sf.seo?.ogImageUrl ?? ""}
          onChange={(e) => patch({ seo: { ...sf.seo, ogImageUrl: e.target.value } })}
        />
      </Section>

      <Button full size="lg" onClick={save} disabled={busy || processing}>
        {busy ? "Guardando…" : processing ? "Preparando imagen…" : "Guardar sitio público"}
      </Button>
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-on-surface-soft uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function FAQEditor({
  items,
  onChange,
}: {
  items: FAQItem[];
  onChange: (items: FAQItem[]) => void;
}) {
  function update(i: number, key: "q" | "a", value: string) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));
  }
  function add() {
    onChange([...items, { q: "", a: "" }]);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="space-y-2 p-3 rounded-lg bg-surface-soft">
          <TextField
            label={`Pregunta ${i + 1}`}
            value={it.q}
            onChange={(e) => update(i, "q", e.target.value)}
          />
          <TextArea
            label="Respuesta"
            value={it.a}
            onChange={(e) => update(i, "a", e.target.value)}
          />
          <Button size="sm" variant="ghost" onClick={() => remove(i)}>
            Quitar
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={add}>
        + Agregar pregunta
      </Button>
    </div>
  );
}

type ImageSlot = "logo" | "desktop" | "mobile";
function imageUrls(sf: Storefront): string[] {
  return [...new Set([sf.logoUrl, sf.hero?.imageUrl, sf.hero?.mobileImageUrl, sf.seo?.ogImageUrl].filter((url): url is string => Boolean(url)))];
}
