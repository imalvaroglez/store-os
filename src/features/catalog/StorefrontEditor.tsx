import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Button,
  TextField,
  TextArea,
  CheckboxField,
  useToast,
} from "../../design-system";
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
  const { updateStore } = useStore();
  const toast = useToast();
  const [sf, setSf] = useState<Storefront>(store.storefront ?? {});
  const [busy, setBusy] = useState(false);

  function patch(next: Partial<Storefront>) {
    setSf((prev) => ({ ...prev, ...next }));
  }
  function patchSection<K extends keyof Storefront>(
    key: K,
    field: "heading" | "body" | "imageUrl",
    value: string
  ) {
    setSf((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as object | undefined), [field]: value || undefined },
    }));
  }

  async function save() {
    setBusy(true);
    try {
      await updateStore({ id: store.id, storefront: sf });
      toast.success("Sitio público actualizado");
      onDone();
    } catch {
      toast.error("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Inicio (hero)">
        <TextField
          label="Título principal"
          placeholder="Olivia"
          value={sf.hero?.heading ?? ""}
          onChange={(e) => patchSection("hero", "heading", e.target.value)}
        />
        <TextArea
          label="Mensaje principal"
          placeholder="Joyería hecha a mano…"
          value={sf.hero?.body ?? ""}
          onChange={(e) => patchSection("hero", "body", e.target.value)}
        />
        <TextField
          label="Imagen de portada (URL)"
          placeholder="https://…"
          value={sf.hero?.imageUrl ?? ""}
          onChange={(e) => patchSection("hero", "imageUrl", e.target.value)}
        />
        <TextArea
          label="Beneficios (uno por línea)"
          hint="Aparecen como viñetas bajo el hero."
          placeholder={"Envíos a todo el país\nPlata 925"}
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
          onChange={(e) => patch({ notice: e.target.value || undefined })}
        />
        <TextArea
          label="Entregas y envíos"
          value={sf.shipping ?? ""}
          onChange={(e) => patch({ shipping: e.target.value || undefined })}
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
          onChange={(e) => patch({ hours: e.target.value || undefined })}
        />
        <TextField
          label="Instagram (usuario o enlace)"
          placeholder="@olivia"
          value={sf.instagram ?? ""}
          onChange={(e) => patch({ instagram: e.target.value || undefined })}
        />
      </Section>

      <Section title="Mensajes de WhatsApp">
        <TextField
          label="Mensaje al comprar (introducción)"
          hint="Se completa solo con nombre, clave y enlace. No lo borres."
          value={sf.whatsappBuyIntro ?? ""}
          onChange={(e) => patch({ whatsappBuyIntro: e.target.value || undefined })}
        />
        <TextField
          label="Mensaje de reventa (introducción)"
          value={sf.whatsappResaleIntro ?? ""}
          onChange={(e) => patch({ whatsappResaleIntro: e.target.value || undefined })}
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
          onChange={(e) => patch({ seo: { ...sf.seo, title: e.target.value || undefined } })}
        />
        <TextArea
          label="Descripción para buscadores"
          value={sf.seo?.description ?? ""}
          onChange={(e) => patch({ seo: { ...sf.seo, description: e.target.value || undefined } })}
        />
        <TextField
          label="Imagen para compartir (URL)"
          value={sf.seo?.ogImageUrl ?? ""}
          onChange={(e) => patch({ seo: { ...sf.seo, ogImageUrl: e.target.value || undefined } })}
        />
      </Section>

      <Button full size="lg" onClick={save} disabled={busy}>
        {busy ? "Guardando…" : "Guardar sitio público"}
      </Button>
    </div>
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
