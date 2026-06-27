import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from "react";

// Unified field styling. Every input/select/textarea in the app uses this base.
export const fieldBase =
  "w-full rounded-md border border-edge bg-surface px-3 py-2.5 text-base text-on-surface outline-none focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 placeholder:text-on-surface-soft/60 transition-colors";

export function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-on-surface-soft uppercase tracking-wide mb-1.5">
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-on-surface-soft/70 mt-1">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <FormField label={label} hint={hint}>
      <input className={fieldBase} {...rest} />
    </FormField>
  );
}

export function TextArea({
  label,
  hint,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <FormField label={label} hint={hint}>
      <textarea className={`${fieldBase} min-h-[80px]`} {...rest} />
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
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  caption?: string;
}) {
  return (
    <FormField label={label} hint={hint}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-5 w-5 accent-ink"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {caption && <span className="text-sm text-ink">{caption}</span>}
      </label>
    </FormField>
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
