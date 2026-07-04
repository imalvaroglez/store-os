// Loading placeholders that mimic the shape of content about to arrive.
// Shimmer via background-position animation; reduced-motion leaves a static tint
// (ThemeProvider nulls --motion-* under prefers-reduced-motion, freezing the loop).
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      role="status"
      className={`rounded-md bg-paper-2 ${className}`}
      style={{
        backgroundImage: "linear-gradient(90deg, transparent, var(--surface) 50%, transparent)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.4s var(--motion-base, 1.4s) linear infinite",
      }}
    />
  );
}

export function SkeletonText({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? "h-3 w-3/5" : "h-3 w-full"} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-card bg-surface border border-rule p-3 shadow-card">
      <Skeleton className="h-24 w-full mb-3" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}
