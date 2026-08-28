import { useEffect, useRef, useState, type ReactNode } from "react";

// Wraps content that fades up when it scrolls into view. Disconnects after the
// first reveal so scrolling back up does not re-animate. In jsdom (no IO) or
// under reduced motion, children render visibly with no animation.
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setShown(true)),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keep the DOM structure stable across the hidden→shown transition: only the
  // style on the inner div changes. Swapping children between two branches would
  // remount them, resetting any internal state of what Reveal wraps.
  return (
    <div ref={ref}>
      <div
        style={
          shown
            ? { animation: "revealUp var(--motion-base) var(--ease-smooth)" }
            : { opacity: 0, transform: "translateY(16px)" }
        }
      >
        {children}
      </div>
    </div>
  );
}
