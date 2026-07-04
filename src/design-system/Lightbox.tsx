import { useEffect, useRef, useState } from "react";
import { IconButton } from "./Button";

interface LightboxImage {
  src: string;
  alt: string;
}

// Full-viewport image viewer for the public catalog. Keyboard nav (←/→, Esc),
// swipe on touch. Reuses the Sheet pattern for ESC + body scroll lock.
export function Lightbox({
  open,
  images,
  index,
  onClose,
}: {
  open: boolean;
  images: LightboxImage[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index, open]);
  const touchX = useRef<number | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;
    // Move focus into the dialog so keyboard/SR users land inside it; restore
    // focus to the trigger on close.
    const id = window.setTimeout(() => overlay.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((p) => (p + 1) % images.length);
      if (e.key === "ArrowLeft") setI((p) => (p - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      lastFocused.current?.focus();
    };
  }, [open, onClose, images.length]);

  if (!open || images.length === 0) return null;
  const img = images[i];

  return (
    <div
      ref={overlay}
      role="dialog"
      aria-modal="true"
      aria-label={img.alt}
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/90 outline-none"
      style={{ animation: "lightboxIn var(--motion-fast) var(--ease-smooth)" }}
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx > 40) setI((p) => (p - 1 + images.length) % images.length);
        if (dx < -40) setI((p) => (p + 1) % images.length);
        touchX.current = null;
      }}
    >
      <div className="absolute top-4 right-4">
        <IconButton variant="ghost" aria-label="Cerrar" onClick={onClose} className="text-paper text-2xl">
          ×
        </IconButton>
      </div>
      <div
        className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "lightboxPop var(--motion-base) var(--ease-spring)" }}
      >
        <img src={img.src} alt={img.alt} className="max-w-[90vw] max-h-[75vh] object-contain rounded-lg" />
        <p className="serif-display text-paper text-lg">{img.alt}</p>
      </div>
    </div>
  );
}
