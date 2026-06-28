// Minimal loading indicator. Uses the on-surface token so it adapts to theme.
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
      <span
        className="h-7 w-7 rounded-full border-2 border-edge border-t-on-surface animate-spin"
        role="status"
        aria-label={label ?? "Cargando"}
      />
      {label && <p className="text-sm text-on-surface-soft">{label}</p>}
    </div>
  );
}
