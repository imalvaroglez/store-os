// @vitest-environment jsdom
// #366/#367: credit blocks must explain themselves in the UI (own file: the
// toast singleton carries state across the long OrderForm suite).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderForm } from "./OrderForm";
import { CreditCoverageError, CreditCustomerChangeError } from "../../app/firebase/firestoreData";
import type { Order } from "../../types";

const { mockUpsertOrder, activeStore, state } = vi.hoisted(() => ({
  mockUpsertOrder: vi.fn().mockResolvedValue(undefined),
  activeStore: {
    id: "store_olivia",
    name: "Olivia",
    slug: "olivia",
    type: "inventory_tiered" as const,
    priceTiers: [{ id: "t_retail", label: "Iconic", order: 0 }],
    defaultTierId: "t_retail",
  },
  state: {
    products: [],
    categories: [],
    customers: [{ id: "customer_1", storeId: "store_olivia", name: "Cliente Olivia", createdAt: "", updatedAt: "" }],
    purchases: [],
  },
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({ state, activeStore, upsertOrder: mockUpsertOrder, draftOwnerId: "uid_test" }),
  };
});

const order: Order = {
  id: "credit-block", storeId: "store_olivia", customerId: "customer_1",
  items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }],
  deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", schemaVersion: 2,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
} as unknown as Order;

describe("#366/#367 — credit blocks explain themselves in the UI", () => {
  it("shows the coverage block message, not the generic retry toast (#366)", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockRejectedValueOnce(new CreditCoverageError("Este pedido sostiene $400.00 de saldo a favor ya usados en otros pedidos."));
    const rendered = render(<ToastProvider><OrderForm order={order} isNew onDone={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/sostiene \$400\.00 de saldo a favor/)).toBeInTheDocument());
    expect(screen.queryByText(/No se pudo guardar el pedido/)).toBeNull();
    rendered.unmount();
  });

  it("shows the clienta-change block with its way out (#367)", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockRejectedValueOnce(new CreditCustomerChangeError("Este pedido tiene saldo a favor aplicado o generado; cambiar la clienta movería ese dinero a otra persona. Restituye el saldo (o termina su uso) antes de cambiar la clienta."));
    const rendered = render(<ToastProvider><OrderForm order={order} isNew onDone={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/Restituye el saldo \(o termina su uso\) antes de cambiar la clienta/)).toBeInTheDocument());
    expect(screen.queryByText(/No se pudo guardar el pedido/)).toBeNull();
    rendered.unmount();
  });
});
