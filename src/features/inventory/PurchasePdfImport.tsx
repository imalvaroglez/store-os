import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, Sheet, TextField, Badge, FileButton, useToast } from "../../design-system";
import { formatMoney, parseAmount } from "../../lib/money";
import { uploadPurchasePdf, importPurchasePdf, type ParsedPdfOrder } from "../../app/firebase/pdfImport";
import type { PurchaseLine } from "../../types";

// purchase-pdf-import: upload a supplier PDF, OCR it server-side, and show an
// EDITABLE review before anything touches the purchase. Human confirmation is
// mandatory — the OCR pre-fills, Fer decides (spec acceptance #2).

type Props = {
  onApply: (lines: PurchaseLine[], meta: { supplierOrder?: string; documentPath?: string; total?: number }) => void;
};

export function PurchasePdfImport({ onApply }: Props) {
  const { activeStore, cloud } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedPdfOrder | null>(null);
  const [documentPath, setDocumentPath] = useState<string>();
  const [folio, setFolio] = useState("");
  const [totalRaw, setTotalRaw] = useState("");

  if (!cloud) return null; // demo local: manual capture only (spec, fuera de alcance)

  async function onFile(file: File) {
    if (!activeStore) return;
    setBusy(true);
    try {
      const { storagePath } = await uploadPurchasePdf(activeStore.id, file);
      const result = await importPurchasePdf(storagePath);
      if (!result.lines.length) {
        toast.error("No pudimos leer el pedido. Captura la compra a mano.");
        return;
      }
      setParsed(result);
      setDocumentPath(storagePath);
      setFolio(result.supplierOrder ?? "");
      setTotalRaw(result.total != null ? String(result.total) : "");
    } catch {
      toast.error("No se pudo importar el PDF. Intenta de nuevo o captura a mano.");
    } finally {
      setBusy(false);
    }
  }

  function updateLine(idx: number, patch: Partial<(ParsedPdfOrder)["lines"][number]>) {
    setParsed((p) => (p ? { ...p, lines: p.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) } : p));
  }

  const sum = parsed?.lines.reduce((s, l) => s + l.quantity * (l.unitAmount ?? 0), 0) ?? 0;
  const declaredTotal = parseAmount(totalRaw);
  const mismatch = declaredTotal != null && Math.abs(declaredTotal - sum) > 0.5;

  function apply() {
    if (!parsed) return;
    const lines: PurchaseLine[] = parsed.lines.map((l) => ({
      productId: "", // unmatched by default — Fer links/creates from the review or later
      name: [l.name, l.color].filter(Boolean).join(" "),
      quantity: l.quantity || 1,
      unitCost: l.quantity > 0 ? l.unitAmount / l.quantity : l.unitAmount,
    }));
    onApply(lines, {
      supplierOrder: folio.trim() || undefined,
      documentPath,
      total: declaredTotal ?? undefined,
    });
    setParsed(null);
  }

  return (
    <div>
      <FileButton
        accept="application/pdf"
        disabled={busy}
        busyLabel="Leyendo pedido…"
        label="Importar pedido (PDF)"
        onSelect={(f) => void onFile(f)}
      />

      {parsed && (
        <Sheet open title="Revisar pedido importado" onClose={() => setParsed(null)}>
          <div className="space-y-3">
            <p className="text-xs text-on-surface-soft">
              Revisa y corrige antes de agregar. Nada se guarda hasta que confirmes.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Pedido proveedor" value={folio} onChange={(e) => setFolio(e.target.value)} />
              <TextField
                label="Total del documento"
                inputMode="decimal"
                value={totalRaw}
                onChange={(e) => setTotalRaw(e.target.value)}
              />
            </div>
            {mismatch && (
              <div>
                <Badge tone="warning">
                  La suma de líneas ({formatMoney(sum)}) no cuadra con el total. Revisa cantidades y precios.
                </Badge>
              </div>
            )}
            <div className="space-y-2">
              {parsed.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_64px_96px] gap-2 items-end">
                  <TextField
                    label={i === 0 ? "Producto" : ""}
                    value={l.name}
                    onChange={(e) => updateLine(i, { name: e.target.value })}
                  />
                  <TextField
                    label={i === 0 ? "Cant." : ""}
                    inputMode="numeric"
                    value={String(l.quantity)}
                    onChange={(e) => updateLine(i, { quantity: parseAmount(e.target.value) ?? 1 })}
                  />
                  <TextField
                    label={i === 0 ? "Importe" : ""}
                    inputMode="decimal"
                    value={String(l.unitAmount)}
                    onChange={(e) => updateLine(i, { unitAmount: parseAmount(e.target.value) ?? 0 })}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-sm text-on-surface-soft">Suma: {formatMoney(sum)}</span>
              <Button onClick={apply}>Agregar {parsed.lines.length} líneas a la compra</Button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
