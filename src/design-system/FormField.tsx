import { useId } from "react";
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
  Ref,
} from "react";

// Unified field styling. Every input/select/textarea in the app uses this base.
export const fieldBase =
  "w-full rounded-md border border-edge bg-surface px-3 py-2.5 text-base text-on-surface outline-none focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 placeholder:text-on-surface-soft/60 transition-colors";

export function FormField({
  label,
  hint,
  children,
  labelClassName = "",
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  labelClassName?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={`block text-xs font-semibold text-on-surface-soft uppercase tracking-wide mb-1.5 ${labelClassName}`}>
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-on-surface-soft/70 mt-1">{hint}</span>}
    </label>
  );
}

export function TextField({
  label, hint, labelClassName, error, id: suppliedId, inputRef, ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; labelClassName?: string; error?: string; inputRef?: Ref<HTMLInputElement> } ) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <FormField label={label} hint={hint} labelClassName={labelClassName}>
      <input ref={inputRef} className={fieldBase} {...rest} id={id}
        aria-invalid={error ? true : rest["aria-invalid"]}
        aria-describedby={[rest["aria-describedby"], error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} />
      {error && <span id={`${id}-error`} className="block text-sm text-danger mt-1">{error}</span>}
    </FormField>
  );
}

export function TextArea({
  label,
  hint,
  fill = false,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  /** #405: stretch to fill the remaining height of a flex column, so the
   * field's surface matches a sibling panel (e.g. the receipt in the share
   * sheet). Without it the textarea keeps its rows-based height. */
  fill?: boolean;
}) {
  return (
    <FormField label={label} hint={hint} className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
      <textarea className={`${fieldBase} min-h-[80px] ${fill ? "flex-1" : ""}`} {...rest} />
    </FormField>
  );
}

// Checkbox as a labeled field (was inline in ProductForm).
export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  caption,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  caption?: string;
  disabled?: boolean;
}) {
  // #324: a checkbox IS its own label — wrapping it in FormField's outer
  // <label> produced nested labels (invalid HTML), and tapping the label
  // text could close the hosting dialog and dump the operator's capture.
  // Single label, checkbox + text inline: the tap toggles the checkbox,
  // exactly what a hand expects.
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 accent-ink"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {caption && <span className="block text-xs text-ink-soft">{caption}</span>}
        {hint && <span className="block text-xs text-on-surface-soft/70 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

// Native select wrapped so feature files never render a raw <select>.
export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  label: string;
  hint?: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  placeholder?: string;
}) {
  return (
    <FormField label={label} hint={hint}>
      <select
        className={fieldBase}
        value={value as string}
        onChange={(e) => onChange(e.target.value as T)}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
