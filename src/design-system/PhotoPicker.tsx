import { useRef } from "react";
import { FormField } from "./FormField";
import { ProductImage } from "./ProductImage";

// Photo picker for product images (cloud mode). Presentational only: it hands a
// raw File up to the caller (which resizes + uploads) and shows a preview. The
// hidden <input type="file"> is internal to this DS component, so the
// design-system gate (which scans only src/features + src/app) is unaffected.

export function PhotoPicker({
  previewUrl,
  busy = false,
  error,
  onSelect,
  onRemove,
}: {
  previewUrl?: string;
  busy?: boolean;
  error?: string;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <FormField label="Foto" hint="Toma una foto o elige de tu galería.">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Elegir foto"
          className="rounded-xl ring-1 ring-rule/70 overflow-hidden shrink-0 disabled:opacity-60"
        >
          {busy ? (
            <div
              className="h-16 w-16 flex items-center justify-center bg-paper-2"
              role="status"
              aria-label="Subiendo foto"
            >
              <span className="h-5 w-5 rounded-full border-2 border-edge border-t-on-surface animate-spin" />
            </div>
          ) : (
            <ProductImage src={previewUrl} alt="" size="thumb" />
          )}
        </button>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="text-sm font-semibold text-terracotta disabled:opacity-60"
          >
            {previewUrl ? "Cambiar foto" : "Subir foto"}
          </button>
          {previewUrl && !busy && (
            <button
              type="button"
              onClick={onRemove}
              className="text-sm text-danger text-left"
            >
              Quitar foto
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
          // Reset so picking the same file twice fires onChange again.
          e.target.value = "";
        }}
      />

      {error && <span className="block text-xs text-danger mt-1">{error}</span>}
    </FormField>
  );
}
