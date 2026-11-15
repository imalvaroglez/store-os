import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../lib/money";

// Money figure with serif display. The first KNOWN value paints immediately —
// a count-up that starts from 0 repaints "$0" on money surfaces during load
// (#406 r2 UX review: never a placeholder zero with a definitive look). Value
// changes settle at once: the number never goes stale, and no in-flight frame
// chain exists to clobber a fresher value (the original #406 stalls).
export function AnimatedNumber({
  value,
  format,
  className = "",
}: {
  value: number;
  format?: "currency";
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current === value) return;
    prevValue.current = value;
    setDisplay(value);
  }, [value]);

  const fmt = (n: number) =>
    format === "currency" ? formatMoney(n) : Math.round(n).toLocaleString("es-MX");

  return (
    <span className={`serif-display tnum ${className}`}>{fmt(display)}</span>
  );
}
