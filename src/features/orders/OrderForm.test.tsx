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


describe("order amount limits", () => {
  it("keeps the form usable and blocks an unsafe amount", () => {
    const order = { id: "large", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText(/Precio unitario/), { target: { value: "900719925474099100" } });
    expect(screen.getByText(/importes o cantidades demasiado grandes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
    rendered.unmount();
  });
});

describe("saved order snapshots", () => {
  it("preserves the saved customer and category when the order is edited", async () => {
    mockUpsertOrder.mockClear();
    const order = { id: "snapshot-order", storeId: "store_olivia", customerId: "customer_1", customerName: "Nombre original", items: [{ productName: "Anillo", quantity: 1, unitPrice: 1.25, subtotal: 1.25, categorySnapshot: { id: "rings", name: "Anillos" } }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect(mockUpsertOrder.mock.calls[0][0].customerName).toBe("Nombre original");
    expect(mockUpsertOrder.mock.calls[0][0].items[0].categorySnapshot).toEqual({ id: "rings", name: "Anillos" });
    rendered.unmount();
  });
});

describe("cent precision when saving", () => {
  it("saves rounded line totals and advances consistently", async () => {
    mockUpsertOrder.mockClear();
    const order = { id: "cents-order", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 3, unitPrice: 0.335, subtotal: 1.005 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Anticipo"), { target: { value: "0.335" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect(mockUpsertOrder.mock.calls[0][0].items[0].subtotal).toBe(1.01);
    expect(mockUpsertOrder.mock.calls[0][0].deposit).toBe(0.34);
    rendered.unmount();
  });
});
