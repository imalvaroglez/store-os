import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../lib/money";

// Counts from 0 to `value` with an ease-out curve, triggered when the element
// scrolls into view (IntersectionObserver). Falls back to the final value when
// IO is unavailable (jsdom) or under prefers-reduced-motion.
export function AnimatedNumber({
  value,
  format,
  duration = 1200,
}: {
  value: number;
  format?: "currency";
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  const fmt = (n: number) =>
    format === "currency" ? formatMoney(n) : Math.round(n).toLocaleString("es-MX");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const run = () => {
      if (started.current) return;
      started.current = true;
      if (prefersReduced) {
        setDisplay(value);
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(value * eased);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }
    // ponytail: no live re-animation on value change (YAGNI). But if `value`
    // changes after the first count completed, jump straight to the new target
    // so the displayed number never goes stale.
    if (started.current) {
      setDisplay(value);
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && run()),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  return (
    <span ref={ref} className="serif-display tnum">
      {fmt(display)}
    </span>
  );
}
