import { Button } from "./Button";

/** Manual-activation tabs: arrows move focus; Enter/Space select via Button. */
export function TabList({ id, label, value, items, onChange, disabled = false }: {
  id: string;
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-2 overflow-x-auto py-1 min-w-0">
      {items.map((item, index) => (
        <Button key={item.value} id={`${id}-tab-${item.value}`} role="tab"
          aria-selected={value === item.value} aria-controls={`${id}-panel`}
          tabIndex={value === item.value ? 0 : -1} disabled={disabled}
          variant={value === item.value ? "primary" : "secondary"}
          title={item.label} className="shrink-0 max-w-56 truncate" onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % items.length
              : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
              : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
            if (next == null) return;
            event.preventDefault();
            document.getElementById(`${id}-tab-${items[next].value}`)?.focus();
          }}>
          {item.label}
        </Button>
      ))}
    </div>
  );
}
