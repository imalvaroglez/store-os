import { useRef } from "react";

// File picker trigger (any file type). The hidden <input type="file"> lives
// inside this DS component so the design-system gate stays meaningful in
// features. Presentational only: it hands the raw File to the caller.

export function FileButton({
  accept,
  disabled = false,
  busyLabel,
  label,
  onSelect,
  ...rest
}: {
  accept?: string;
  disabled?: boolean;
  busyLabel?: string;
  label: string;
  onSelect: (file: File) => void;
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={rest.className ?? "text-sm font-semibold text-accent disabled:opacity-60 py-2 px-3 rounded-xl ring-1 ring-rule/70 bg-surface"}
      >
        {disabled && busyLabel ? busyLabel : label}
      </button>
    </>
  );
}
