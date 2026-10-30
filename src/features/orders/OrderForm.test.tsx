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
      categoryIds: ["cat_rings"],
      isPublic: true,
      status: "published" as const,
      prices: { t_retail: 100, t_girly: 70 },
      createdAt: "",
      updatedAt: "",
    }],
    categories: [{ id: "cat_rings", storeId: "store_olivia", name: "Anillos" }],
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
    useStore: () => ({ state, activeStore, upsertOrder: mockUpsertOrder, draftOwnerId: "uid_test" }),
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
    const key = orderDraftKey(order.storeId, order.id, false, "uid_test");
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
    const key = orderDraftKey(order.storeId, order.id, false, "uid_test");
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
    const key = orderDraftKey(order.storeId, order.id, false, "uid_test");
    saveOrderDraft(key, { orderUpdatedAt: "2026-01-01", expectedRevision: 1, mutationId: "ack-op", savedAt: order.updatedAt, customerId: "customer_1", customerQuery: "Cliente Olivia", lines: [{ key: "saved", productName: "Anillo", productQuery: "Anillo", quantity: 1, quantityText: "1", unitPrice: 50, unitPriceText: "50", costText: "", subtotal: 50 }], deposit: "0", promisedDate: "", orderStatus: "asked", notes: "" });
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(screen.queryByText(/captura anterior basada/)).toBeNull();
    expect(screen.queryByText("Borrador recuperado")).toBeNull();
    rendered.unmount();
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

describe("new order lines prepend (OLI-011)", () => {
  it("adds the fresh line at the top, keeping captured content below", () => {
    localStorage.clear(); // other tests in this file leave drafts behind
    const order = {
      id: "prepend_order", storeId: "store_olivia", customerId: "customer_1",
      items: [{ productName: "Arete dorado", quantity: 1, unitPrice: 100, subtotal: 100 }],
      deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const,
      schemaVersion: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01",
    };
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    // The saved line is the only one so far, pre-filled from its snapshot.
    expect((screen.getAllByLabelText("Producto")[0] as HTMLInputElement).value).toBe("Arete dorado");
    // Add a new line: it must land on TOP (visible without scrolling — Fer
    // captures 40–50 lines per order).
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar línea" }));
    const after = screen.getAllByLabelText("Producto");
    expect(after).toHaveLength(2);
    expect((after[0] as HTMLInputElement).value).toBe(""); // fresh empty line first
    expect((after[1] as HTMLInputElement).value).toBe("Arete dorado"); // captured content preserved below
    // Line numbering follows the visual order.
    expect(screen.getByText("Línea 1")).toBeInTheDocument();
    expect(screen.getByText("Línea 2")).toBeInTheDocument();
  });
});

describe("fast order capture", () => {
  it("adds a focused line above existing lines without changing their values", () => {
    render(
      <ToastProvider>
        <OrderForm order={{ id: "order_fast", storeId: "store_olivia", customerId: "customer_1", items: Array.from({ length: 49 }, (_, index) => ({ productName: index === 0 ? "Anillo" : `Pieza ${index}`, quantity: 2, unitPrice: 50, subtotal: 100 })), deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", schemaVersion: 2, createdAt: "", updatedAt: "" }} onDone={() => {}} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar línea" }));
    const products = Array.from(document.querySelectorAll<HTMLInputElement>("input[role=combobox]")).slice(1);
    expect(products).toHaveLength(50);
    expect(products[0]).toHaveFocus();
    expect(products[1]).toHaveValue("Anillo");
    expect(screen.getAllByLabelText("Cantidad")[1]).toHaveValue("2");
    expect(screen.getAllByLabelText(/Precio unitario/)[1]).toHaveValue("50");
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
describe("order review by category", () => {
  it("keeps lines distinct and returns to edit the selected line", async () => {
    mockUpsertOrder.mockClear();
    const order = { id: "review-order", storeId: "store_olivia", customerId: "customer_1", items: [
      { productName: "Anillo uno", quantity: 1, unitPrice: 10, subtotal: 10, categorySnapshot: { id: "rings", name: "Anillos" } },
      { productName: "Pulsera", quantity: 2, unitPrice: 20, subtotal: 40, categorySnapshot: { id: "bracelets", name: "Pulseras" } },
      { productName: "Anillo dos", quantity: 3, unitPrice: 10, subtotal: 30, categorySnapshot: { id: "rings", name: "Anillos" } },
      { productName: "Encargo", quantity: 1, unitPrice: 10, subtotal: 10 },
    ], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Revisar por categoría" }));
    expect(screen.getByRole("heading", { name: "Anillos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pulseras" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sin categoría" })).toBeInTheDocument();
    expect(screen.getByText("1 × Anillo uno")).toBeInTheDocument();
    expect(screen.getByText("3 × Anillo dos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar Anillo dos" }));
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[role="combobox"]'));
    expect(document.activeElement).toBe(inputs.find((input) => input.value === "Anillo dos"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect(mockUpsertOrder.mock.calls[0][0].items.map((item: { categorySnapshot?: { name: string } }) => item.categorySnapshot?.name)).toEqual(["Anillos", "Pulseras", "Anillos", undefined]);
    rendered.unmount();
  });

  it("snapshots the primary category when selecting a catalog product", async () => {
    mockUpsertOrder.mockClear();
    const order = { id: "new-group", storeId: "store_olivia", customerId: "customer_1", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Arete dorado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect(mockUpsertOrder.mock.calls[0][0].items[0].categorySnapshot).toEqual({ id: "cat_rings", name: "Anillos" });
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
