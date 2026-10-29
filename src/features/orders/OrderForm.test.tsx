// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderForm } from "./OrderForm";

const { mockUpsertOrder, activeStore, state } = vi.hoisted(() => ({
  mockUpsertOrder: vi.fn().mockResolvedValue(undefined),
  activeStore: {
    id: "store_olivia",
    name: "Olivia",
    slug: "olivia",
    type: "inventory_tiered" as const,
    priceTiers: [
      { id: "t_retail", label: "Iconic", order: 0 },
      { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
    ],
    defaultTierId: "t_retail",
  },
  state: {
    products: [{
      id: "prod_olivia_1",
      storeId: "store_olivia",
      name: "Arete dorado",
      category: "jewelry" as const,
      isPublic: true,
      status: "published" as const,
      prices: { t_retail: 100, t_girly: 70 },
      createdAt: "",
      updatedAt: "",
    }],
    customers: [{
      id: "customer_1",
      storeId: "store_olivia",
      name: "Cliente Olivia",
      createdAt: "",
      updatedAt: "",
    }],
  },
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({ state, activeStore, upsertOrder: mockUpsertOrder }),
  };
});

describe("OrderForm price override", () => {
  it("persists the selected tier and the edited unit price together", async () => {
    render(
      <ToastProvider>
        <OrderForm
          order={{
            id: "order_new",
            storeId: "store_olivia",
            customerId: "customer_1",
            items: [],
            deposit: 0,
            orderStatus: "asked",
            paymentStatus: "unpaid",
            schemaVersion: 2,
            createdAt: "",
            updatedAt: "",
          }}
          onDone={() => {}}
        />
      </ToastProvider>
    );

    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Arete dorado" } });
    const tierSelect = document.querySelector("select");
    expect(tierSelect).toBeTruthy();
    fireEvent.change(tierSelect!, { target: { value: "t_girly" } });
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));

    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect(mockUpsertOrder.mock.calls[0][0].items[0]).toMatchObject({
      productId: "prod_olivia_1",
      priceTier: "t_girly",
      unitPrice: 123,
      subtotal: 123,
    });
  });
});

describe("recovered order drafts", () => {
  it("discards a restored draft without recreating it", async () => {
    const { saveOrderDraft, orderDraftKey } = await import("./orderDraft");
    const order = { id: "draft_order", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const key = orderDraftKey(order.storeId, order.id, false);
    saveOrderDraft(key, { orderUpdatedAt: order.updatedAt, savedAt: order.updatedAt, customerId: "customer_1", customerQuery: "Cliente Olivia", lines: [{ key: "saved", productName: "Anillo", productQuery: "Anillo", quantity: 2, quantityText: "2", unitPrice: 50, unitPriceText: "50", costText: "", subtotal: 100 }], deposit: "0", promisedDate: "", orderStatus: "asked", notes: "" });
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.queryByText("Borrador recuperado")).toBeNull();
    rendered.unmount();
  });

  it("keeps a conflicting draft available without overwriting it", async () => {
    const { saveOrderDraft, orderDraftKey } = await import("./orderDraft");
    const order = { id: "conflict_order", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, revision: 2, createdAt: "2026-01-01", updatedAt: "2026-02-01" };
    const key = orderDraftKey(order.storeId, order.id, false);
    saveOrderDraft(key, { orderUpdatedAt: "2026-01-01", expectedRevision: 1, savedAt: order.updatedAt, customerId: "customer_1", customerQuery: "Cliente Olivia", lines: [{ key: "old", productName: "Aretes perdidos", productQuery: "Aretes perdidos", quantityText: "1", unitPriceText: "50", costText: "" }], deposit: "0", promisedDate: "", orderStatus: "asked", notes: "" });
    const original = localStorage.getItem(key);
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    expect(screen.getByText(/captura anterior basada/)).toBeInTheDocument();
    expect(screen.getByText(/Aretes perdidos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Notas"), { target: { value: "Nueva captura" } });
    expect(localStorage.getItem(key)).toBe(original);
    rendered.unmount();
  });
});

describe("retrying a new order after an interruption", () => {
  it("restores the order and operation identity before retrying", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const order = { id: "retry-original", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const first = render(<ToastProvider><OrderForm order={order} isNew onDone={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    const [firstOrder, firstOptions] = mockUpsertOrder.mock.calls[0];
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled());
    first.unmount();
    const again = render(<ToastProvider><OrderForm order={{ ...order, id: "new-random-id", createdAt: "2026-02-01", updatedAt: "2026-02-01" }} isNew onDone={() => {}} /></ToastProvider>);
    expect(screen.getByText("Borrador recuperado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(2));
    expect(mockUpsertOrder.mock.calls[1][0].id).toBe(firstOrder.id);
    expect(mockUpsertOrder.mock.calls[1][1].mutationId).toBe(firstOptions.mutationId);
    again.unmount();
  });
});

describe("acknowledged order drafts", () => {
  it("clears a draft if its operation was already committed", async () => {
    const { saveOrderDraft, orderDraftKey } = await import("./orderDraft");
    const order = { id: "ack-order", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, revision: 2, lastMutationId: "ack-op", createdAt: "2026-01-01", updatedAt: "2026-02-01" };
    const key = orderDraftKey(order.storeId, order.id, false);
    saveOrderDraft(key, { orderUpdatedAt: "2026-01-01", expectedRevision: 1, mutationId: "ack-op", savedAt: order.updatedAt, customerId: "customer_1", customerQuery: "Cliente Olivia", lines: [{ key: "saved", productName: "Anillo", productQuery: "Anillo", quantity: 1, quantityText: "1", unitPrice: 50, unitPriceText: "50", costText: "", subtotal: 50 }], deposit: "0", promisedDate: "", orderStatus: "asked", notes: "" });
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(screen.queryByText(/captura anterior basada/)).toBeNull();
    expect(screen.queryByText("Borrador recuperado")).toBeNull();
    rendered.unmount();
  });
});
