// @vitest-environment jsdom
// #552 — when a «Nuevo pedido» save finds the order already stored (its own
// earlier interrupted save), the editor must describe the VERIFIED state,
// keep the pending capture and let the operator reconcile onto the saved
// revision. A genuinely stale edit stays blocked but can CONSULT the current
// version without losing the capture (own file: toast singleton state).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderForm } from "./OrderForm";
import { OrderAlreadySavedError, StaleOrderError } from "../../app/firebase/firestoreData";
import type { Order } from "../../types";

const { mockUpsertOrder, activeStore, state } = vi.hoisted(() => ({
  mockUpsertOrder: vi.fn().mockResolvedValue(undefined),
  activeStore: {
    id: "store_olivia",
    name: "Olivia",
    slug: "olivia",
    type: "inventory_tiered" as const,
    priceTiers: [{ id: "t_retail", label: "Regular", order: 0 }],
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

const newOrderShell: Order = {
  id: "order_recover",
  storeId: "store_olivia",
  customerId: "customer_1",
  items: [{ productName: "Anillo", quantity: 2, unitPrice: 50, subtotal: 100 }],
  deposit: 0,
  orderStatus: "asked",
  paymentStatus: "unpaid",
  schemaVersion: 2,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as unknown as Order;

/** What the transaction read canonically: this draft's earlier save. */
const savedVersion: Order = {
  ...newOrderShell,
  revision: 1,
  customerName: "Cliente Olivia",
  lastMutationId: "mut-first",
} as Order;

describe("#552 — recuperar la captura cuando el pedido ya existe", () => {
  it("describe el estado verificado sin culpar a otro dispositivo, conserva la captura y muestra la versión guardada", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockRejectedValueOnce(new OrderAlreadySavedError(savedVersion));
    const rendered = render(
      <ToastProvider>
        <OrderForm order={newOrderShell} isNew onDone={() => {}} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/ya está guardado/i)).toBeInTheDocument());
    expect(screen.queryByText(/otro dispositivo/i)).toBeNull();
    // La captura sigue abierta: el formulario no se cerró ni se vació.
    expect((screen.getByRole("button", { name: "Guardar pedido" }) as HTMLButtonElement).disabled).toBe(false);
    // La versión guardada queda a la vista para comparar (revisión y clienta).
    await waitFor(() => expect(screen.getByText(/revisión 1/i)).toBeInTheDocument());
    expect(screen.getByText(/Cliente Olivia/)).toBeInTheDocument();
    rendered.unmount();
  });

  it("la reconciliación reintenta SOBRE la revisión guardada, con la misma captura y su intención", async () => {
    localStorage.clear();
    mockUpsertOrder
      .mockReset()
      .mockRejectedValueOnce(new OrderAlreadySavedError(savedVersion))
      .mockResolvedValueOnce(savedVersion);
    const rendered = render(
      <ToastProvider>
        <OrderForm order={newOrderShell} isNew onDone={() => {}} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/ya está guardado/i)).toBeInTheDocument());
    const firstCall = mockUpsertOrder.mock.calls[0][1];
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(2));
    const retry = mockUpsertOrder.mock.calls[1][1];
    // El reintento reconciliado edita la revisión vigente con la MISMA
    // intención (idempotente si la respuesta se pierde otra vez).
    expect(retry.expectedRevision).toBe(1);
    expect(retry.mutationId).toBe(firstCall.mutationId);
    rendered.unmount();
  });

  it("una edición realmente desactualizada sigue bloqueada y consulta la versión vigente sin perder la captura", async () => {
    localStorage.clear();
    const currentVersion = { ...savedVersion, revision: 2 } as Order;
    mockUpsertOrder.mockReset().mockRejectedValue(new StaleOrderError(currentVersion));
    const rendered = render(
      <ToastProvider>
        <OrderForm order={{ ...newOrderShell, revision: 1 } as Order} onDone={() => {}} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/cambió/i)).toBeInTheDocument());
    // La versión vigente es consultable y la captura sigue abierta.
    await waitFor(() => expect(screen.getByText(/revisión 2/i)).toBeInTheDocument());
    expect((screen.getByRole("button", { name: "Guardar pedido" }) as HTMLButtonElement).disabled).toBe(false);
    rendered.unmount();
  });
});
