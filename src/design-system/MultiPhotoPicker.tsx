import { useRef } from "react";
import { ProductImage } from "./ProductImage";
import { IconButton } from "./Button";

// Multi-photo picker for a product gallery (1–5 images). Presentational: it
// hands raw Files up to the caller and shows tiles with reorder / primary /
// remove controls. The hidden <input type="file"> is internal to this DS
// component, so the design-system gate (scans src/features + src/app) is clean.

export type GalleryTile = {
  id: string;
  url: string; // remote URL or local object-URL preview
  isPrimary: boolean;
  busy?: boolean;
};

export function MultiPhotoPicker({
  tiles,
  max,
  busy = false,
  error,
  onAdd,
  onRemove,
  onMakePrimary,
  onMove,
}: {
  tiles: GalleryTile[];
  max: number;
  busy?: boolean;
  error?: string;
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
  onMakePrimary: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const atMax = tiles.length >= max;

  return (
    <div>
      <span className="block text-xs font-semibold text-on-surface-soft uppercase tracking-wide mb-1.5">
        Fotos ({tiles.length}/{max})
      </span>
      <span className="block text-xs text-on-surface-soft/70 mb-2">
        La primera es la portada. Hasta {max} fotos.
      </span>

      <ul className="grid grid-cols-3 gap-2">
        {tiles.map((tile, i) => (
          <li
            key={tile.id}
            className="relative rounded-xl ring-1 ring-rule/70 overflow-hidden aspect-square bg-paper-2"
          >
            {tile.busy ? (
              <div
                className="h-full w-full flex items-center justify-center"
                role="status"
                aria-label="Subiendo foto"
              >
                <span className="h-5 w-5 rounded-full border-2 border-edge border-t-on-surface animate-spin" />
              </div>
            ) : (
              <ProductImage src={tile.url} alt="" size="full" />
            )}
            {tile.isPrimary && (
              <span className="absolute top-1 left-1 rounded bg-ink/80 text-paper text-[10px] font-semibold px-1.5 py-0.5">
                Portada
              </span>
            )}
            {/* Controls overlay (always visible; tap targets ≥40px via IconButton). */}
            <div className="absolute bottom-1 right-1 flex gap-1">
              <IconButton
                variant="ghost"
                aria-label="Mover izquierda"
                disabled={i === 0 || tile.busy}
                onClick={() => onMove(tile.id, -1)}
                className="h-8 w-8 bg-paper/80"
              >
                ←
              </IconButton>
              <IconButton
                variant="ghost"
                aria-label="Mover derecha"
                disabled={i === tiles.length - 1 || tile.busy}
                onClick={() => onMove(tile.id, 1)}
                className="h-8 w-8 bg-paper/80"
              >
                →
              </IconButton>
            </div>
            <div className="absolute top-1 right-1 flex gap-1">
              {!tile.isPrimary && (
                <IconButton
                  variant="ghost"
                  aria-label="Marcar como portada"
                  disabled={tile.busy}
                  onClick={() => onMakePrimary(tile.id)}
                  className="h-8 w-8 bg-paper/80"
                >
                  ★
                </IconButton>
              )}
              <IconButton
                variant="ghost"
                aria-label="Quitar foto"
                disabled={tile.busy}
                onClick={() => onRemove(tile.id)}
                className="h-8 w-8 bg-paper/80 text-danger"
              >
                ✕
              </IconButton>
            </div>
          </li>
        ))}

        {!atMax && (
          <li>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              aria-label="Agregar foto"
              className="w-full aspect-square rounded-xl border-2 border-dashed border-rule flex items-center justify-center text-on-surface-soft hover:border-terracotta hover:text-terracotta transition-colors disabled:opacity-60"
            >
              <span className="text-3xl leading-none">+</span>
            </button>
          </li>
        )}
      </ul>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          for (const f of files) onAdd(f);
          e.target.value = "";
        }}
      />

      {error && <span className="block text-xs text-danger mt-1">{error}</span>}
    </div>
  );
}
