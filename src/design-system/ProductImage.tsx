// Image with a graceful paper placeholder. Replaces the repeated
// `{imageUrl ? <img> : <div>🛍️</div>}` block across catalog screens.
export function ProductImage({
  src,
  alt,
  size = "thumb",
  className = "",
}: {
  src?: string;
  alt: string;
  size?: "thumb" | "full";
  className?: string;
}) {
  const dims = size === "full" ? "w-full h-48" : "h-16 w-16";
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`${dims} ${size === "full" ? "" : "rounded-xl"} object-cover bg-paper-2 ring-1 ring-rule/70 shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      className={`${dims} rounded-xl bg-paper-2 ring-1 ring-rule/70 shrink-0 flex items-center justify-center text-terracotta/50 ${
        size === "full" ? "text-5xl" : "text-2xl"
      } ${className}`}
    >
      🛍️
    </div>
  );
}
