import { useState } from "react";
import { useStore, newCategory } from "../../app/StoreProvider";
import {
  Button,
  Card,
  Badge,
  EmptyState,
  ScreenHeader,
  Screen,
  Sheet,
  TextField,
  TextArea,
  SelectField,
  ProductImage,
  IconButton,
  Dialog,
  useToast,
} from "../../design-system";
import { categoriesForStore } from "../../lib/selectors";
import { productsForStore } from "../../lib/selectors";
import { slugify } from "../../lib/catalog";
import type { Category } from "../../types";

// Categorías admin: create / reorder / deactivate / edit. A category cannot be
// deleted while products reference it (the product's primary category is required
// to publish, so dropping it would strand products). Deactivate instead.
export function CategoriesScreen() {
  const { state, activeStore, upsertCategory, deleteCategory } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);

  if (!activeStore) return null;
  const categories = categoriesForStore(state.categories, activeStore.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const products = productsForStore(state.products, activeStore.id);

  // How many products reference a category (primary or secondary)?
  const usageCount = (catId: string) =>
    products.filter((p) => (p.categoryIds ?? []).includes(catId)).length;

  const move = (cat: Category, dir: -1 | 1) => {
    const idx = categories.findIndex((c) => c.id === cat.id);
    const swapWith = categories[idx + dir];
    if (!swapWith) return;
    upsertCategory({ ...cat, sortOrder: swapWith.sortOrder, updatedAt: nowIso() });
    upsertCategory({ ...swapWith, sortOrder: cat.sortOrder, updatedAt: nowIso() });
  };

  return (
    <Screen>
      <ScreenHeader
        title="Categorías"
        subtitle={`${categories.length} ${categories.length === 1 ? "categoría" : "categorías"}`}
        action={<Button onClick={() => setCreating(true)}>+ Agregar</Button>}
      />

      {categories.length === 0 ? (
        <EmptyState
          title="Sin categorías"
          subtitle="Crea categorías para organizar tu catálogo (anillos, collares, pulseras…)."
          icon={<div className="text-6xl">🏷️</div>}
        />
      ) : (
        <div className="space-y-2">
          {categories.map((c, i) => {
            const used = usageCount(c.id);
            return (
              <Card key={c.id}>
                <div className="flex items-center gap-3">
                  <ProductImage src={c.imageUrl} alt={c.name} size="thumb" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-ink truncate">{c.name || "Sin nombre"}</h3>
                      <Badge tone={c.active ? "success" : "neutral"}>
                        {c.active ? "Activa" : "Oculta"}
                      </Badge>
                    </div>
                    <p className="text-xs text-on-surface-soft">
                      /{c.slug} · {used} {used === 1 ? "producto" : "productos"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      variant="ghost"
                      aria-label="Subir"
                      disabled={i === 0}
                      onClick={() => move(c, -1)}
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      aria-label="Bajar"
                      disabled={i === categories.length - 1}
                      onClick={() => move(c, 1)}
                    >
                      ↓
                    </IconButton>
                    <IconButton variant="ghost" aria-label="Editar" onClick={() => setEditing(c)}>
                      ✎
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      aria-label="Eliminar"
                      onClick={() => setDeleting(c)}
                    >
                      🗑
                    </IconButton>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet open={creating} onClose={() => setCreating(false)} title="Agregar categoría">
        <CategoryForm
          category={newCategory(activeStore.id, "")}
          onDone={() => setCreating(false)}
        />
      </Sheet>

      {editing && (
        <Sheet open onClose={() => setEditing(null)} title="Editar categoría">
          <CategoryForm category={editing} onDone={() => setEditing(null)} />
        </Sheet>
      )}

      <Dialog
        open={deleting !== null}
        title="Eliminar categoría"
        tone="danger"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting) {
                  if (usageCount(deleting.id) > 0) {
                    toast.error("Esta categoría tiene productos. Ocúltala en su lugar.");
                  } else {
                    deleteCategory(deleting.id);
                    toast.success(`«${deleting.name}» eliminada`);
                  }
                }
                setDeleting(null);
              }}
            >
              Eliminar
            </Button>
          </>
        }
      >
        {deleting && usageCount(deleting.id) > 0 ? (
          <>
            <span className="font-semibold text-ink">{deleting.name}</span> tiene{" "}
            {usageCount(deleting.id)} productos. Muévelos o desasígnalos antes de eliminarla,
            o simplemente ocúltala.
          </>
        ) : (
          <>
            ¿Eliminar <span className="font-semibold text-ink">{deleting?.name}</span>? Esta
            acción no se puede deshacer.
          </>
        )}
      </Dialog>
    </Screen>
  );
}

function CategoryForm({ category, onDone }: { category: Category; onDone: () => void }) {
  const { upsertCategory } = useStore();
  const [draft, setDraft] = useState<Category>(category);

  function submit() {
    if (!draft.name.trim()) return;
    const slug = draft.slug || slugify(draft.name);
    upsertCategory({
      ...draft,
      name: draft.name.trim(),
      slug,
      id: `${draft.storeId}__${slug}`,
      updatedAt: nowIso(),
    });
    onDone();
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Nombre"
        placeholder="Ej. Anillos"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        autoFocus
      />
      <TextField
        label="Enlace público"
        hint={category.slug ? "Se conserva para no romper enlaces compartidos." : "Se genera automáticamente al guardar."}
        placeholder="anillos"
        value={draft.slug}
        onChange={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })}
        disabled={!!category.slug}
      />
      <TextArea
        label="Descripción"
        hint="Aparece en la página de la categoría del catálogo."
        placeholder="Lo que verá tu cliente…"
        value={draft.description ?? ""}
        onChange={(e) => setDraft({ ...draft, description: e.target.value || undefined })}
      />
      <TextField
        label="Imagen (URL)"
        placeholder="https://…"
        value={draft.imageUrl ?? ""}
        onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value || undefined })}
      />
      {/* ponytail: status select reused as active toggle; a real toggle is YAGNI here. */}
      <SelectField
        label="Estado"
        value={draft.active ? "active" : "hidden"}
        onChange={(v) => setDraft({ ...draft, active: v === "active" })}
        options={[
          { value: "active", label: "Activa (visible en el catálogo)" },
          { value: "hidden", label: "Oculta" },
        ]}
      />
      <Button full size="lg" onClick={submit} disabled={!draft.name.trim()}>
        Guardar categoría
      </Button>
    </div>
  );
}

function nowIso() {
  return new Date().toISOString();
}
