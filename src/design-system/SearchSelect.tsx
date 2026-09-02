import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { fieldBase, FormField } from "./FormField";

export type SearchSelectOption = {
  value: string;
  label: string;
  detail?: ReactNode;
  keywords?: string;
};

export function SearchSelect({
  label,
  value,
  options,
  onChange,
  onSelect,
  placeholder,
  emptyLabel = "No hay coincidencias.",
}: {
  label: string;
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  onSelect: (option: SearchSelectOption) => void;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputId = useId();
  const listId = `${inputId}-list`;

  const filtered = useMemo(() => {
    const needle = value.trim().toLocaleLowerCase("es-MX");
    if (!needle) return options.slice(0, 50);
    return options
      .filter((option) => `${option.label} ${option.keywords ?? ""}`.toLocaleLowerCase("es-MX").includes(needle))
      .slice(0, 50);
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  function select(option: SearchSelectOption) {
    onSelect(option);
    setOpen(false);
    setActive(0);
  }

  return (
    <FormField label={label}>
      <div ref={rootRef} className="relative">
        <input
          id={inputId}
          className={fieldBase}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={open && filtered[active] ? `${listId}-option-${active}` : undefined}
          placeholder={placeholder}
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            // Tab/click away closes the listbox; focus moving INTO the listbox
            // (option click) must keep it open or the click would never land.
            if (!rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && open && filtered[active]) {
              event.preventDefault();
              select(filtered[active]);
            }
          }}
        />

        {open && (
          <div
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-40 mt-2 max-h-64 overflow-y-auto rounded-lg border border-edge bg-surface p-1.5 shadow-lift"
          >
            {filtered.length > 0 ? filtered.map((option, index) => (
              <button
                key={option.value}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`block min-h-10 w-full rounded-md px-3 py-2 text-left transition-colors ${
                  index === active ? "bg-surface-muted" : "hover:bg-surface-muted"
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => select(option)}
              >
                <span className="block truncate text-sm font-semibold text-on-surface">{option.label}</span>
                {option.detail && <span className="block truncate text-xs text-on-surface-soft">{option.detail}</span>}
              </button>
            )) : (
              <p className="px-3 py-3 text-sm text-on-surface-soft" role="status">{emptyLabel}</p>
            )}
          </div>
        )}
      </div>
    </FormField>
  );
}
