import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../lib/money";

// Counts from 0 to `value` with an ease-out curve, triggered when the element
// scrolls into view (IntersectionObserver). Falls back to the final value when
// IO is unavailable (jsdom) or under prefers-reduced-motion.
//
// #406: the count-up is DECORATIVE; the number must never stay stale. Two
// real-world stalls are covered: (1) frames of a superseded animation run
// clobbering a value that landed mid-count — each effect run owns its rAF
// chain and cancels it on cleanup; (2) the observer never arming (throttled
// frame delivery, e.g. embedded webviews) while data loads — any value change
// settles immediately, and a fallback timer settles even if the observer
// never fires at all.
export function AnimatedNumber({
  value,
  format,
  duration = 1200,
  className = "",
}: {
  value: number;
  format?: "currency";
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);
  const prevValue = useRef(value);

  const fmt = (n: number) =>
    format === "currency" ? formatMoney(n) : Math.round(n).toLocaleString("es-MX");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let frame = 0;
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
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }

    const valueChanged = prevValue.current !== value;
    prevValue.current = value;
    // ponytail: no live re-animation on value change (YAGNI). Any value change
    // —armed or not— settles immediately so the displayed number never goes
    // stale, and the pending chain of a previous target dies with its effect.
    if (valueChanged) {
      started.current = true;
      setDisplay(value);
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && run()),
      { threshold: 0.15 }
    );
    io.observe(el);
    // The observer never arming must not freeze the number: settle after the
    // animation window even if it never reported intersection.
    const fallback = window.setTimeout(() => {
      if (!started.current) {
        started.current = true;
        setDisplay(value);
      }
    }, duration + 300);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={`serif-display tnum ${className}`}>
      {fmt(display)}
    </span>
  );
}
