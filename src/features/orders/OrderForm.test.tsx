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

describe("customer price assignment", () => {
  it("asks before switching customers and preserves manual prices", async () => {
    state.customers.push({ id: "sofia", storeId: "store_olivia", name: "Sofía", assignedPriceTierId: "t_girly", createdAt: "", updatedAt: "" } as typeof state.customers[number]);
    mockUpsertOrder.mockClear();
    const order = { id: "price-order", storeId: "store_olivia", customerId: "customer_1", items: [
      { productId: "prod_olivia_1", productName: "Arete dorado", quantity: 1, unitPrice: 100, subtotal: 100, priceTier: "t_retail", priceSource: "automatic" as const },
      { productId: "prod_olivia_1", productName: "Arete dorado", quantity: 1, unitPrice: 123, subtotal: 123, priceTier: "t_retail", priceSource: "manual" as const },
    ], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Sofía" } });
    expect(screen.getByText("Cambiar cliente")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precios de Sofía" }));
    const prices = screen.getAllByLabelText(/Precio unitario/);
    expect(prices[0]).toHaveValue("70");
    expect(prices[1]).toHaveValue("123");
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect(mockUpsertOrder.mock.calls[0][0].items.map((item: { unitPrice: number }) => item.unitPrice)).toEqual([70, 123]);
    rendered.unmount();
    state.customers.pop();
  });

  it("requires an explicit price when the assigned tier has no price", async () => {
    state.customers.push({ id: "sofia", storeId: "store_olivia", name: "Sofía", assignedPriceTierId: "t_girly", createdAt: "", updatedAt: "" } as typeof state.customers[number]);
    state.products.push({ ...state.products[0], id: "no-girly", name: "Anillo sin precio", prices: { t_retail: 80 } as typeof state.products[number]["prices"] });
    mockUpsertOrder.mockClear();
    const order = { id: "missing-order", storeId: "store_olivia", customerId: "sofia", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Anillo sin precio" } });
    expect(screen.getByText(/Falta capturar el precio/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    expect(mockUpsertOrder).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Precio unitario/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect(mockUpsertOrder.mock.calls[0][0].items[0].unitPrice).toBe(0);
    rendered.unmount();
    state.products.pop();
    state.customers.pop();
  });
});

describe("customer changes and unavailable tiers", () => {
  it("keeps captured prices when requested and cancels a subsequent change", () => {
    state.customers.push({ id: "sofia2", storeId: "store_olivia", name: "Sofía", assignedPriceTierId: "t_girly", createdAt: "", updatedAt: "" } as typeof state.customers[number]);
    const order = { id: "keep-order", storeId: "store_olivia", customerId: "customer_1", items: [{ productId: "prod_olivia_1", productName: "Arete dorado", quantity: 1, unitPrice: 100, subtotal: 100, priceSource: "automatic" as const }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Sofía" } });
    fireEvent.click(screen.getByRole("button", { name: "Conservar importes" }));
    expect(screen.getByLabelText(/Precio unitario/)).toHaveValue("100");
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Cliente Olivia" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByLabelText("Cliente")).toHaveValue("Sofía");
    expect(screen.getByLabelText(/Precio unitario/)).toHaveValue("100");
    rendered.unmount();
    state.customers.pop();
  });

  it("requires a replacement when an assigned tier is no longer available", () => {
    state.customers.push({ id: "hidden", storeId: "store_olivia", name: "Teresa", assignedPriceTierId: "removed-tier", createdAt: "", updatedAt: "" } as typeof state.customers[number]);
    const order = { id: "hidden-order", storeId: "store_olivia", customerId: "hidden", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Arete dorado" } });
    expect(screen.getByText(/ya no está disponible/)).toBeInTheDocument();
    expect(screen.getByText(/Falta capturar el precio/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nivel de precio para el pedido"), { target: { value: "t_retail" } });
    expect(screen.getByLabelText(/Precio unitario/)).toHaveValue("100");
    rendered.unmount();
    state.customers.pop();
  });
});

describe("explicit line tier", () => {
  it("preserves a tier chosen before selecting a product", () => {
    const order = { id: "tier-first", storeId: "store_olivia", customerId: "customer_1", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText(/Nivel de precio/), { target: { value: "t_girly" } });
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Arete dorado" } });
    expect(screen.getByLabelText(/Precio unitario/)).toHaveValue("70");
    rendered.unmount();
  });
});

describe("changing a selected product", () => {
  it("keeps a catalog price automatic after changing the product search", () => {
    state.customers.push({ id: "sofia3", storeId: "store_olivia", name: "Sofía", assignedPriceTierId: "t_girly", createdAt: "", updatedAt: "" } as typeof state.customers[number]);
    const order = { id: "change-product", storeId: "store_olivia", customerId: "customer_1", items: [{ productId: "prod_olivia_1", productName: "Arete dorado", quantity: 1, unitPrice: 100, subtotal: 100, priceTier: "t_retail", priceSource: "automatic" as const }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Arete" } });
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Arete dorado" } });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Sofía" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precios de Sofía" }));
    expect(screen.getByLabelText(/Precio unitario/)).toHaveValue("70");
    rendered.unmount();
    state.customers.pop();
  });
});
