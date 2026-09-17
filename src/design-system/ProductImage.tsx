import { useState } from "react";
// Image with a graceful paper placeholder. Replaces the repeated
// `{imageUrl ? <img> : <div>🛍️</div>}` block across catalog screens.
export function ProductImage({
  src,
  alt,
  size = "thumb",
  className = "",
  natural = false,
  loading = "lazy",
  placeholder,
}: {
  src?: string;
  alt: string;
  size?: "thumb" | "full";
  className?: string;
  natural?: boolean;
  placeholder?: string;
  loading?: "eager" | "lazy";
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const dims = size === "full" ? (natural ? "w-full h-auto" : "w-full aspect-square") : "h-16 w-16";
  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        onError={() => setFailedSrc(src)}
        className={`${dims} ${size === "full" ? "" : "rounded-xl"} ${natural ? "object-contain" : "object-cover bg-paper-2 ring-1 ring-rule/70"} shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={alt || "Imagen no disponible"}
      className={`${dims} rounded-xl bg-paper-2 ring-1 ring-rule/70 shrink-0 flex items-center justify-center text-terracotta/50 ${
        size === "full" ? "text-5xl" : "text-2xl"
      } ${className}`}
    >
      {placeholder ? <span className="text-xs font-normal text-center px-3 text-ink-soft">{placeholder}</span> : "🛍️"}
    </div>
  );
}
