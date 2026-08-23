import { useRef } from "react";
import { Button } from "./Button";

// File picker trigger (any file type). The hidden <input type="file"> lives
// inside this DS component so the design-system gate stays meaningful in
// features. Presentational only: it hands the raw File to the caller. Renders
// through Button so variant/size and tap-target sizing stay consistent.

export function FileButton({
  accept,
  disabled = false,
  busyLabel,
  label,
  onSelect,
  variant = "secondary",
  size = "md",
  className,
}: {
  accept?: string;
  disabled?: boolean;
  busyLabel?: string;
  label: string;
  onSelect: (file: File) => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
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
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {disabled && busyLabel ? busyLabel : label}
      </Button>
    </>
  );
}
