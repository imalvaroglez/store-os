import { useState, type ReactNode } from "react";
import { Button, TextArea, TextField } from "../../design-system";
import type { FAQItem } from "../../types";

export function InlineEditable({
  enabled,
  label,
  value,
  displayValue,
  placeholder,
  multiline = false,
  render,
  onChange,
}: {
  enabled: boolean;
  label: string;
  value: string;
  displayValue?: string;
  placeholder: string;
  multiline?: boolean;
  render: (value: string) => ReactNode;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const visibleValue = enabled ? value : displayValue ?? value;

  if (!enabled) return <>{render(visibleValue)}</>;

  if (open) return <div className="space-y-2 rounded-md border border-dashed border-edge p-2">
    {multiline
      ? <TextArea label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      : <TextField label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
    <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Listo</Button>
  </div>;

  return <div className="rounded-md border border-dashed border-edge p-1">
    <Button className="w-full justify-start text-left whitespace-normal" variant="ghost" onClick={() => setOpen(true)} aria-label={`Editar ${label}`}>
      <span className="min-w-0 flex-1">{visibleValue.trim() ? render(visibleValue) : <span className="text-on-surface-soft">{placeholder}</span>}</span>
      <span aria-hidden="true" className="ml-2 text-on-surface-soft">✎</span>
    </Button>
  </div>;
}

export function InlineFaqEditor({
  enabled,
  value,
  onChange,
}: {
  enabled: boolean;
  value: FAQItem[];
  onChange: (value: FAQItem[]) => void;
}) {
  if (!enabled) return <div className="olv-faq">{value.map((item, index) => <details key={index}>
    <summary>{item.q}<span aria-hidden="true">+</span></summary>
    <p>{item.a}</p>
  </details>)}</div>;

  return <div className="space-y-3 rounded-md border border-dashed border-edge p-3">
    <h3 className="text-sm font-semibold text-on-surface">Preguntas frecuentes</h3>
    {value.map((item, index) => <fieldset key={index} className="space-y-2 rounded-md border border-edge p-3">
      <legend className="px-1 text-xs text-on-surface-soft">Pregunta {index + 1}</legend>
      <TextField label="Pregunta" value={item.q} placeholder="Escribe la pregunta" onChange={(event) => onChange(value.map((current, i) => i === index ? { ...current, q: event.target.value } : current))} />
      <TextArea label="Respuesta" value={item.a} placeholder="Escribe la respuesta" onChange={(event) => onChange(value.map((current, i) => i === index ? { ...current, a: event.target.value } : current))} />
      <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, i) => i !== index))}>Quitar pregunta</Button>
    </fieldset>)}
    <Button size="sm" variant="secondary" onClick={() => onChange([...value, { q: "", a: "" }])}>+ Agregar pregunta</Button>
  </div>;
}
