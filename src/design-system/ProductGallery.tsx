import { useRef, useState } from "react";
import { IconButton, Button } from "./Button";
import { ProductImage } from "./ProductImage";

/** Only the selected full image loads. Swiping never triggers the product link. */
export function ProductGallery({ images, name, href, onNavigate, thumbnails = false }: {
  images: { url: string; alt?: string | null }[];
  name: string;
  href?: string;
  onNavigate?: () => void;
  thumbnails?: boolean;
}) {
  const [active, setActive] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const index = Math.min(active, Math.max(0, images.length - 1));
  const move = (delta: number) => setActive((index + delta + images.length) % images.length);
  const photo = <ProductImage src={images[index]?.url} alt={images[index]?.alt || name} size="full" placeholder="Imagen no disponible" />;
  return (
    <div className="olv-gallery">
      <div className="olv-photo" style={{ touchAction: "pan-y" }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          start.current = { x: touch.clientX, y: touch.clientY };
          swiped.current = false;
        }}
        onTouchEnd={(event) => {
          const touch = event.changedTouches[0];
          if (!start.current || !touch) return;
          const dx = touch.clientX - start.current.x;
          const dy = touch.clientY - start.current.y;
          if (images.length > 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            move(dx < 0 ? 1 : -1);
            swiped.current = true;
          }
          start.current = null;
        }}>
        {href ? <a href={href} aria-label={`Ver ${name}`} onClick={(event) => {
          if (swiped.current) { event.preventDefault(); swiped.current = false; return; }
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0 && onNavigate) {
            event.preventDefault(); onNavigate();
          }
        }}>{photo}</a> : photo}
        {images.length > 1 && <div className="olv-gallery-controls">
          <IconButton aria-label={`Foto anterior de ${name}`} onClick={() => move(-1)}>‹</IconButton>
          <span aria-live="polite" aria-atomic="true">{index + 1} / {images.length}</span>
          <IconButton aria-label={`Foto siguiente de ${name}`} onClick={() => move(1)}>›</IconButton>
        </div>}
      </div>
      {thumbnails && images.length > 1 && <div className="olv-thumbnails" aria-label="Fotos de la pieza">
        {images.map((image, i) => <Button key={`${image.url}-${i}`} variant="ghost" aria-label={`Ver foto ${i + 1}`} aria-pressed={index === i} onClick={() => setActive(i)}>
          <ProductImage src={image.url} alt={image.alt || ""} />
        </Button>)}
      </div>}
    </div>
  );
}
