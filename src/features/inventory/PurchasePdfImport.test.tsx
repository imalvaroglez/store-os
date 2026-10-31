// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { PurchasePdfImport } from "./PurchasePdfImport";
import type { Purchase } from "../../types";

const { upload, importPdf, deletePdf, state } = vi.hoisted(() => ({
  upload: vi.fn(), importPdf: vi.fn(), deletePdf: vi.fn().mockResolvedValue(undefined), state: { purchases: [] as Purchase[] },
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ activeStore: { id: "store" }, cloud: true, state }) }));
vi.mock("../../app/firebase/pdfImport", () => ({ uploadPurchasePdf: upload, importPurchasePdf: importPdf }));
vi.mock("../../app/firebase/storage", () => ({ deletePurchasePdf: deletePdf }));

const fingerprint = "ab".repeat(32);
beforeEach(() => {
  upload.mockReset(); importPdf.mockReset(); deletePdf.mockClear(); state.purchases.length = 0;
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer) } });
});
afterEach(() => vi.unstubAllGlobals());

function chooseFile() {
  const file = new File(["ticket"], "ticket.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
}

describe("multi-ticket PDF deduplication", () => {
  it("does not upload or parse a PDF already present in the current journey", async () => {
    render(<ToastProvider><PurchasePdfImport onApply={() => {}} existingFingerprints={[fingerprint]} /></ToastProvider>);
    chooseFile();
    await waitFor(() => expect(screen.getByText("Este PDF ya está agregado a uno de los tickets de esta compra.")).toBeVisible());
    expect(upload).not.toHaveBeenCalled();
    expect(importPdf).not.toHaveBeenCalled();
  });
  it("also detects fingerprints inside tickets saved in another purchase", async () => {
    state.purchases.push({ id: "old", storeId: "store", date: "2026-10-30", status: "draft", lines: [], subtotal: 0, totalConfirmed: 0, createdAt: "", updatedAt: "", tickets: [{ id: "one", totalConfirmed: 0, documentFingerprint: fingerprint }] });
    render(<ToastProvider><PurchasePdfImport onApply={() => {}} /></ToastProvider>);
    chooseFile();
    await waitFor(() => expect(screen.getByText(/Este documento parece haber sido importado antes/)).toBeVisible());
    expect(upload).not.toHaveBeenCalled();
    expect(importPdf).not.toHaveBeenCalled();
  });
  it("removes an uploaded file when no lines can be extracted", async () => {
    upload.mockResolvedValue({ storagePath: "purchases/store/unreadable.pdf" });
    importPdf.mockResolvedValue({ lines: [] });
    const onApply = vi.fn();
    render(<ToastProvider><PurchasePdfImport onApply={onApply} /></ToastProvider>);
    chooseFile();
    await waitFor(() => expect(screen.getByText("No pudimos leer el pedido. Captura la compra a mano.")).toBeVisible());
    expect(deletePdf).toHaveBeenCalledWith("purchases/store/unreadable.pdf");
    expect(onApply).not.toHaveBeenCalled();
  });
});
