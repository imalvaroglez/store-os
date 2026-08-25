import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, FileButton, useToast } from "../../design-system";
import { uploadPurchasePdf, importPurchasePdf } from "../../app/firebase/pdfImport";
import { deletePurchasePdf } from "../../app/firebase/storage";
import { purchasesForStore } from "../../lib/selectors";
import { effectivePurchaseStatus, type PurchaseLine } from "../../types";

// purchase-pdf-import: upload a supplier PDF, OCR it server-side, dedupe by
// fingerprint, and hand the parsed draft to the shared purchase editor. The
// HUMAN stays in charge: the editor's review table is where anything real
// happens (spec invariants 1–3).

export type PdfApplyPayload = {
  lines: PurchaseLine[];
  supplierOrder?: string;
  supplierCandidate?: string;
  documentPath?: string;
  fingerprint?: string;
  discount?: number;
  shipping?: number;
  total?: number;
  dateLabel?: string; // raw date label from the PDF ("ago 19")
};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function PurchasePdfImport({ onApply }: { onApply: (payload: PdfApplyPayload) => void }) {
  const { activeStore, cloud, state } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);

  if (!cloud) return null; // demo local: manual capture only (spec, fuera de alcance)

  async function onFile(file: File, skipDuplicateCheck = false) {
    if (!activeStore) return;
    setBusy(true);
    try {
      const fingerprint = await sha256Hex(file);
      if (!skipDuplicateCheck) {
        const existing = purchasesForStore(state.purchases, activeStore.id).find(
          (p) => p.documentFingerprint === fingerprint
        );
        if (existing) {
          setDuplicate(true);
          toast.error(
            `Este documento parece haber sido importado antes (compra del ${existing.date}${
              effectivePurchaseStatus(existing) === "received" ? ", ya recibida" : ""
            }). Si son compras distintas, impórtalo de todos modos.`
          );
          return;
        }
      }
      setDuplicate(false);
      const { storagePath } = await uploadPurchasePdf(activeStore.id, file);
      let result;
      try {
        result = await importPurchasePdf(storagePath);
      } catch (e) {
        // The upload already landed; if the callable died before OCR (timeout,
        // maxInstances contention, network), nothing else will clean it up.
        // Best-effort delete — a purchase referencing it wins if it exists.
        await deletePurchasePdf(storagePath).catch(() => {});
        throw e;
      }
      if (!result.lines.length) {
        toast.error("No pudimos leer el pedido. Captura la compra a mano.");
        return;
      }
      const lines: PurchaseLine[] = result.lines.map((l) => ({
        productId: "",
        name: l.name,
        variant: l.variant,
        quantity: l.quantity || 1,
        unitCost: l.unitCost ?? 0,
        sourceAmount: l.sourceAmount,
        sourceAmountType: result.sourceAmountType,
        matchStatus: "unmatched",
      }));
      onApply({
        lines,
        supplierOrder: result.supplierOrder,
        supplierCandidate: result.supplierCandidate,
        documentPath: storagePath,
        fingerprint,
        dateLabel: result.dateLabel,
        discount: result.discount,
        shipping: result.shipping,
        total: result.total,
      });
    } catch {
      toast.error("No se pudo importar el PDF. Intenta de nuevo o captura a mano.");
    } finally {
      setBusy(false);
    }
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
      {duplicate && (
        <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
          <span>¿Son compras distintas?</span>
          <FileButton
            accept="application/pdf"
            disabled={busy}
            busyLabel="Leyendo pedido…"
            label="Importar de todos modos"
            onSelect={(f) => void onFile(f, true)}
          />
          <Button size="sm" variant="ghost" onClick={() => setDuplicate(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}
