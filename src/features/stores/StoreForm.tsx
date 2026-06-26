import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, FormField, TextField, Card } from "../../design-system";
import type { StoreType } from "../../types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const TYPES: { value: StoreType; label: string; desc: string }[] = [
  { value: "on_demand", label: "Bajo pedido", desc: "No guardas inventario. Perfumes, tenis, gorras." },
  { value: "inventory_tiered", label: "Inventario y precios", desc: "Tienes stock y precios por nivel. Joyería." },
];

export function StoreForm({ onDone }: { onDone: () => void }) {
  const { addStore, state } = useStore();
  const [name, setName] = useState("");
  const [type, setType] = useState<StoreType>("on_demand");
  const [whatsapp, setWhatsapp] = useState("");

  function submit() {
    if (!name.trim()) return;
    const base = slugify(name) || "tienda";
    // ponytail: simple uniqueness by suffix; collisions are rare in local-first.
    let slug = base;
    let i = 2;
    while (state.stores.some((s) => s.slug === slug)) slug = `${base}-${i++}`;
    addStore({
      name: name.trim(),
      slug,
      type,
      whatsappPhone: whatsapp.trim() || undefined,
    });
    onDone();
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Nombre de la tienda"
        placeholder="Ej. Santi"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <FormField label="Tipo de tienda">
        <div className="space-y-2">
          {TYPES.map((t) => (
            <Card
              key={t.value}
              interactive
              onClick={() => setType(t.value)}
              className={
                type === t.value
                  ? "border-ink bg-paper-2 ring-2 ring-ink/10"
                  : ""
              }
            >
              <span className="block font-semibold text-ink">{t.label}</span>
              <span className="block text-xs text-ink-soft">{t.desc}</span>
            </Card>
          ))}
        </div>
      </FormField>
      <TextField
        label="Teléfono de WhatsApp"
        hint="Con clave de país, ej. 5215512345678"
        placeholder="52155..."
        inputMode="tel"
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
      />
      <Button full size="lg" onClick={submit} disabled={!name.trim()}>
        Crear tienda
      </Button>
    </div>
  );
}
