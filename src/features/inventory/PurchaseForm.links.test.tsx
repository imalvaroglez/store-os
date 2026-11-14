// @vitest-environment jsdom
// #211: al capturar el código de un ticket del proveedor identificado, la
// asociación CONFIRMADA previa sugiere el producto (verificable antes de
// guardar); vincular ofrece confirmar la asociación para compras futuras.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { PurchaseForm } from "./PurchaseForm";
import type { Purchase, Product, SupplierProductLink } from "../../types";

const mocks = vi.hoisted(() => ({
  state: {
    products: [] as Product[],
    purchases: [],
    categories: [],
    suppliers: [],
    supplierLinks: [] as SupplierProductLink[],
  },
  activeStore: { id: "olivia", name: "Olivia", type: "inventory_tiered" },
  upsertPurchase: vi.fn().mockResolvedValue(undefined),
  upsertProduct: vi.fn().mockResolvedValue(undefined),
  createDraftProductsForPurchase: vi.fn().mockResolvedValue(undefined),
  receivePurchase: vi.fn().mockResolvedValue("received"),
  adjustReceivedPurchase: vi.fn().mockResolvedValue(undefined),
  confirmSupplierLink: vi.fn().mockResolvedValue(undefined),
  revokeSupplierLink: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ ...mocks, cloud: true, state: mocks.state, activeStore: mocks.activeStore }) }));

const NOW = "2026-11-14T10:00:00.000Z";

const purchase = (): Purchase => ({
  id: "purchase", storeId: "olivia", date: "2026-11-14", status: "draft",
  tickets: [{ id: "t1", supplierId: "sup1", supplierName: "Prov Uno", totalConfirmed: 0 }],
  lines: [{ lineId: "l0", ticketId: "t1", productId: "", name: "", quantity: 1, unitCost: 0 }],
  subtotal: 0, totalConfirmed: 0, createdAt: "", updatedAt: "",
});

const aro: Product = {
  id: "p_aro", storeId: "olivia", name: "Aro Luna", category: "other", isPublic: true, status: "published",
  prices: { t: 300 }, quantityOnHand: 5, cost: 80, createdAt: NOW, updatedAt: NOW,
} as unknown as Product;

const link = (code: string, productId: string): SupplierProductLink => ({
  id: `olivia__sup1__${code}`, storeId: "olivia", supplierId: "sup1", code,
  normalizedCode: code, productId, productName: productId, confirmedAt: NOW, confirmedBy: "u1",
});

function open(value = purchase()) {
  return render(<ToastProvider><PurchaseForm purchase={value} onDone={() => {}} /></ToastProvider>);
}

beforeEach(() => {
  mocks.state.products = [aro];
  mocks.state.supplierLinks = [];
  mocks.confirmSupplierLink.mockClear().mockResolvedValue(undefined);
});

describe("#211 sugerencia por código confirmado", () => {
  it("capturar un código con asociación única sugiere el producto — verificable antes de guardar", async () => {
    mocks.state.supplierLinks = [link("ar0123", "p_aro")];
    open();
    const nameInput = await screen.findByLabelText("Producto del ticket");
    fireEvent.change(nameInput, { target: { value: "AR-O123" } }); // código con O de ticket mal impreso
    // La sugerencia aparece como acción visible: aplicar la asocia (verificable).
    const apply = await screen.findByRole("button", { name: /Usar Aro Luna/i });
    fireEvent.click(apply);
    await waitFor(() => {
      // «Producto en Store OS» queda vinculado con la ficha sugerida.
      expect(screen.getByLabelText("Producto en Store OS")).toHaveValue("Aro Luna");
    });
  });

  it("sin asociación o proveedor distinto NO adivina: la línea queda sin identificar", async () => {
    mocks.state.supplierLinks = [link("zzz9", "p_aro")]; // otro código
    open();
    const nameInput = await screen.findByLabelText("Producto del ticket");
    fireEvent.change(nameInput, { target: { value: "AR-0123" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Usar /i })).toBeNull());
  });

  it("vincular manualmente ofrece confirmar la asociación para compras futuras", async () => {
    open();
    // Escribe el código del ticket y elige el producto manualmente.
    fireEvent.change(await screen.findByLabelText("Producto del ticket"), { target: { value: "AR-0123" } });
    const search = screen.getByLabelText("Producto en Store OS");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "Aro" } });
    fireEvent.click(await screen.findByRole("option", { name: /Aro Luna/ }));
    // Aparece la oferta de recordar la asociación (explícita, nunca silenciosa).
    const remember = await screen.findByRole("button", { name: /Recordar «AR-0123»/i });
    fireEvent.click(remember);
    await waitFor(() => expect(mocks.confirmSupplierLink).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: "olivia", supplierId: "sup1", code: "AR-0123", productId: "p_aro" })
    ));
  });
});
