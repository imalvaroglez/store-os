// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderForm } from "./OrderForm";
import type { Order, Purchase } from "../../types";

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
      imageUrl: "https://example.test/arete.jpg",
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
    purchases: [] as Purchase[],
  },
}));

describe("foto del producto en la línea", () => {
  it("muestra la portada de la pieza seleccionada y la quita al dejar la captura libre", () => {
    state.products.push({
      ...state.products[0],
      id: "prod_olivia_2",
      name: "Collar azul",
      imageUrl: "https://example.test/collar.jpg",
    } as typeof state.products[number]);
    const order = {
      id: "photo-order",
      storeId: "store_olivia",
      customerId: "customer_1",
      items: [{ productId: "prod_olivia_1", productName: "Arete dorado", quantity: 1, unitPrice: 100, subtotal: 100 }],
      deposit: 0,
      orderStatus: "asked" as const,
      paymentStatus: "unpaid" as const,
      schemaVersion: 2,
      createdAt: "",
      updatedAt: "",
    };
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);

    expect(screen.getByRole("img", { name: "Foto de Arete dorado" })).toHaveAttribute("src", "https://example.test/arete.jpg");
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Collar azul" } });
    fireEvent.click(screen.getByRole("option", { name: /Collar azul/ }));
    const collarPhoto = screen.getByRole("img", { name: "Foto de Collar azul" });
    expect(collarPhoto).toHaveAttribute("src", "https://example.test/collar.jpg");
    fireEvent.error(collarPhoto);
    expect(screen.getByRole("img", { name: "Foto de Collar azul" })).not.toHaveAttribute("src");
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Pieza personalizada" } });
    expect(screen.queryByRole("img", { name: /Collar azul/ })).not.toBeInTheDocument();
    state.products.pop();
  });
});

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

  it("survives an unsafe amount on a line WITH known cost (Codex repro)", () => {
    // The profit preview computes with the line's cost; an excessive price
    // used to throw RangeError during render and unmount the whole form.
    const order = { id: "large_cost", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50, cost: 20 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText(/Precio unitario/), { target: { value: "900719925474099100" } });
    expect(screen.getByText(/importes o cantidades demasiado grandes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
    // The capture stays editable, not exploded.
    expect((screen.getByLabelText(/Precio unitario/) as HTMLInputElement).value).toBe("900719925474099100");
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

  it("shows the failure in Spanish, keeps the capture and never claims success", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockRejectedValueOnce(new Error("offline"));
    const onDone = vi.fn();
    const order = { id: "failed-save", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const rendered = render(<ToastProvider><OrderForm order={order} isNew onDone={onDone} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/No se pudo guardar el pedido/)).toBeInTheDocument());
    // No false success: the saved toast never appears and the editor stays open.
    expect(screen.queryByText("Pedido guardado")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    // The captured line is still on screen, ready to retry.
    expect(screen.getByDisplayValue("Anillo")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled());
    rendered.unmount();
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
    // Stack view: the LAST captured item (manual 123) renders on top.
    const prices = screen.getAllByLabelText(/Precio unitario/);
    expect(prices[0]).toHaveValue("123");
    expect(prices[1]).toHaveValue("70");
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
    // Article numbers follow CAPTURE order (stable): the saved article keeps
    // "Artículo 1" (rendered BELOW), the fresh one is "Artículo 2" on top.
    expect(screen.getByText("Artículo 1")).toBeInTheDocument();
    expect(screen.getByText("Artículo 2")).toBeInTheDocument();
    // The stack view shows the NEWEST first; "Artículo 1" is the second card.
    const labels = screen.getAllByText(/^Artículo \d+$/);
    expect(labels[0]).toHaveTextContent("Artículo 2");
    expect(labels[1]).toHaveTextContent("Artículo 1");
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
    expect(products[0]).toHaveFocus(); // fresh line on top of the stack
    expect(products[49]).toHaveValue("Anillo"); // first captured stays at the bottom
    expect(screen.getAllByLabelText("Cantidad")[49]).toHaveValue("2");
    expect(screen.getAllByLabelText(/Precio unitario/)[49]).toHaveValue("50");
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

describe("installment plan capture (#165)", () => {
  beforeEach(() => {
    // All new-order editors share one draft key; keep each case isolated.
    localStorage.clear();
  });

  const baseOrder = {
    id: "order_plan",
    storeId: "store_olivia",
    customerId: "customer_1",
    items: [{ lineId: "l1", productId: "prod_olivia_1", productName: "Arete dorado", quantity: 1, unitPrice: 1800, subtotal: 1800 }],
    deposit: 0,
    orderStatus: "asked" as const,
    paymentStatus: "unpaid" as const,
    schemaVersion: 2,
    createdAt: "",
    updatedAt: "",
  };

  function fillPlan(cuotas: string, frequency: string, firstDueDate: string) {
    fireEvent.click(screen.getByRole("checkbox", { name: /pagos por partes/i }));
    fireEvent.change(screen.getByLabelText("Número de cuotas"), { target: { value: cuotas } });
    fireEvent.change(screen.getByLabelText("Frecuencia"), { target: { value: frequency } });
    fireEvent.change(screen.getByLabelText("Primera fecha de vencimiento"), { target: { value: firstDueDate } });
  }

  it("shows the derived agreement before confirming and saves the plan", async () => {
    mockUpsertOrder.mockClear();
    const rendered = render(
      <ToastProvider>
        <OrderForm order={{ ...baseOrder }} isNew onDone={() => {}} />
      </ToastProvider>
    );
    fillPlan("6", "monthly", "2026-11-15");
    // Acuerdo visible ANTES de guardar: importes exactos y última fecha.
    expect(screen.getByText(/6 cuotas/i)).toBeInTheDocument();
    expect(screen.getAllByText("$300.00").length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText(/última/i).textContent).toMatch(/2027/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    const saved = mockUpsertOrder.mock.calls[0][0];
    expect(saved.installments).toMatchObject({ count: 6, frequency: "monthly", firstDueDate: "2026-11-15" });
    expect(saved.deposit).toBe(0); // sin anticipo separado (decisión iii)
    rendered.unmount();
  });

  it("rejects an invalid cuota count without saving", async () => {
    mockUpsertOrder.mockClear();
    const rendered = render(
      <ToastProvider>
        <OrderForm order={{ ...baseOrder }} isNew onDone={() => {}} />
      </ToastProvider>
    );
    fillPlan("0", "monthly", "2026-11-15");
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/cuotas válido/i)).toBeInTheDocument());
    expect(mockUpsertOrder).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it("requires frequency and first due date — nothing is defaulted", async () => {
    mockUpsertOrder.mockClear();
    const rendered = render(
      <ToastProvider>
        <OrderForm order={{ ...baseOrder }} isNew onDone={() => {}} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /pagos por partes/i }));
    fireEvent.change(screen.getByLabelText("Número de cuotas"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/elige la frecuencia/i)).toBeInTheDocument());
    expect(mockUpsertOrder).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it("keeps the reservation mark and plan history when editing a plan order", async () => {
    mockUpsertOrder.mockClear();
    const withPlan = {
      ...baseOrder,
      installments: { count: 6, frequency: "monthly" as const, firstDueDate: "2026-11-15", agreedAt: "2026-11-01", agreedBy: "u1" },
      installmentsReservedAt: "2026-11-02T10:00:00.000Z",
      installmentsHistory: [{ count: 3, frequency: "monthly" as const, firstDueDate: "2026-11-15", agreedAt: "2026-10-01", agreedBy: "u1", replacedAt: "2026-11-01T09:00:00.000Z" }],
    };
    const rendered = render(
      <ToastProvider>
        <OrderForm order={withPlan} onDone={() => {}} />
      </ToastProvider>
    );
    // El interruptor llega prendido y el anticipo heredado se conserva oculto.
    expect((screen.getByRole("checkbox", { name: /pagos por partes/i }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    const saved = mockUpsertOrder.mock.calls[0][0];
    expect(saved.installmentsReservedAt).toBe("2026-11-02T10:00:00.000Z");
    expect(saved.installmentsHistory).toHaveLength(1);
    expect(saved.installments?.count).toBe(6);
    rendered.unmount();
  });

  it("hides the anticipo field while the plan is on (no separate down payment)", () => {
    const rendered = render(
      <ToastProvider>
        <OrderForm order={{ ...baseOrder }} isNew onDone={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByLabelText("Anticipo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /pagos por partes/i }));
    expect(screen.queryByLabelText("Anticipo")).toBeNull();
    rendered.unmount();
  });
});

describe("estimated profit while registering a sale", () => {
  it("previews precio − costo − gastos de venta in the totals bar", () => {
    state.products.push({ ...state.products[0], id: "prod_cost", name: "Collar con costo", cost: 40 } as typeof state.products[number]);
    state.purchases.push({
      id: "trip_profit", storeId: "store_olivia", date: "2026-10-30", status: "received", costingMethod: "latest_purchase",
      receivedAt: "2026-11-01T00:00:00.000Z", subtotal: 400, totalConfirmed: 400, createdAt: "", updatedAt: "",
      lines: [{ lineId: "line", productId: "prod_cost", name: "Collar con costo", quantity: 10, unitCost: 40 }],
      costAllocations: [{ lineId: "line", merchandiseCents: 40000, supplierAdjustmentCents: 0, sourcingExpenseCents: 0, saleExpenseCents: 500, totalCents: 40000 }],
    });
    const order = { id: "profit-order", storeId: "store_olivia", customerId: "customer_1", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Collar con costo" } });
    // $100.00 (precio Iconic) − $40.00 (costo) − $0.50 (entrega 50¢/pieza) = $59.50.
    expect(screen.getByText("Ganancia")).toBeInTheDocument();
    expect(screen.getByText("$59.50")).toBeInTheDocument();
    rendered.unmount();
    state.products.pop();
    state.purchases.pop();
  });

  it("keeps the estimate honest when no line has a cost", () => {
    const order = { id: "no-cost-order", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Anillo sin costo", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const rendered = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    expect(screen.getByText("Ganancia")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    rendered.unmount();
  });
});


describe("canonical money in the editor (#225)", () => {
  const base: Order = {
    id: "editor-225", storeId: "store_olivia", customerId: "customer_1",
    items: [{ productName: "Pieza", quantity: 1, unitPrice: 720, subtotal: 720 }],
    deposit: 0, paymentsReceivedCents: 59000, inheritedDepositMaterialized: true,
    orderStatus: "asked", paymentStatus: "partial",
    createdAt: "2026-11-06", updatedAt: "2026-11-06",
  };
  const expectSummary = (received: string, balance: string) => {
    // #234 added a fixed action bar that repeats Total/Saldo: EVERY surface
    // showing money (summary + bar) must carry the SAME canonical value.
    for (const el of screen.getAllByText("Saldo")) {
      expect(el.parentElement).toHaveTextContent(balance);
    }
    expect(screen.getByText("Recibido").parentElement).toHaveTextContent(received);
  };

  it.each<{ name: string; fields: Partial<Order>; received: string; balance: string }>([
    { name: "registered payments", fields: {}, received: "$590.00", balance: "$130.00" },
    { name: "legacy deposit without records", fields: { deposit: 150, paymentsReceivedCents: undefined, inheritedDepositMaterialized: undefined }, received: "$150.00", balance: "$570.00" },
    { name: "negative adjustment before deposit materialization", fields: { deposit: 150, paymentsReceivedCents: -2000, inheritedDepositMaterialized: false }, received: "$130.00", balance: "$590.00" },
    { name: "materialized deposit counted only once", fields: { deposit: 590 }, received: "$590.00", balance: "$130.00" },
    { name: "applied credit kept separate from received money", fields: { creditAppliedCents: 3000 }, received: "$590.00", balance: "$100.00" },
    { name: "incident adjustment", fields: { incidents: [{ id: "inc-225", productName: "Pieza", quantity: 1, reason: "Defecto", originalUnitPriceCents: 72000, resolution: { kind: "replacement_with_difference", saleAdjustmentUnitCents: 72000 }, replacement: { productName: "Otra pieza", unitPriceCents: 77000, unitCostCents: 10000, chargeDifference: true }, events: [] }] }, received: "$590.00", balance: "$180.00" },
  ])("shows $name", ({ fields, received, balance }) => {
    localStorage.clear();
    render(<ToastProvider><OrderForm order={{ ...base, ...fields }} onDone={() => {}} /></ToastProvider>);
    expectSummary(received, balance);
    expect(screen.getByLabelText(/^Anticipo/)).toHaveValue(String(fields.deposit ?? 0));
  });

  it("recalculates edited prices and quantities without losing received money", () => {
    localStorage.clear();
    render(<ToastProvider><OrderForm order={base} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText(/Precio unitario/), { target: { value: "800" } });
    expectSummary("$590.00", "$210.00");
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "2" } });
    expectSummary("$590.00", "$1,010.00");
  });

  it("previews a permitted legacy deposit edit alongside a negative adjustment", () => {
    localStorage.clear();
    render(<ToastProvider><OrderForm order={{ ...base, deposit: 150, paymentsReceivedCents: -2000, inheritedDepositMaterialized: false }} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Anticipo"), { target: { value: "100" } });
    expectSummary("$80.00", "$640.00");
  });

  it("refreshes totals when the canonical payment evidence changes", () => {
    localStorage.clear();
    const view = render(<ToastProvider><OrderForm order={base} onDone={() => {}} /></ToastProvider>);
    expectSummary("$590.00", "$130.00");
    view.rerender(<ToastProvider><OrderForm order={{ ...base, paymentsReceivedCents: 62000 }} onDone={() => {}} /></ToastProvider>);
    expectSummary("$620.00", "$100.00");
  });
});

describe("legacy anticipo guards (#218)", () => {
  const order = { id: "guard-218", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Pieza", quantity: 1, unitPrice: 720, subtotal: 720 }], deposit: 590, paymentsReceivedCents: 59000, orderStatus: "asked" as const, paymentStatus: "partial" as const, createdAt: "2026-11-06", updatedAt: "2026-11-06" };
  it("disables the anticipo once materialized", () => {
    localStorage.clear();
    render(<ToastProvider><OrderForm order={{ ...order, inheritedDepositMaterialized: true }} onDone={() => {}} /></ToastProvider>);
    expect(screen.getByLabelText(/^Anticipo/)).toBeDisabled();
    expect(screen.getByText("El anticipo ya está registrado en el historial de cobros.")).toBeInTheDocument();
  });
  it.each([720, 0])("guards increases but allows repair to %s", async (amount) => {
    localStorage.clear();
    mockUpsertOrder.mockClear();
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Anticipo"), { target: { value: String(amount) } });
    if (amount < order.deposit) {
      // #271: the sanctioned repair now carries its signed motive.
      fireEvent.change(await screen.findByLabelText("Motivo de la corrección del anticipo"), { target: { value: "Depósito duplicado: el cobro ya lo cubre" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    if (amount > order.deposit) {
      expect(await screen.findByText("El anticipo no puede subir cuando el pedido ya tiene cobros. Registra un cobro.")).toBeInTheDocument();
      expect(mockUpsertOrder).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalled());
      expect(mockUpsertOrder.mock.calls[0][0].deposit).toBe(0);
    }
  });
  it("ignores a draft's inflated anticipo when the order has payment evidence", async () => {
    localStorage.clear();
    const { orderDraftKey, saveOrderDraft } = await import("./orderDraft");
    const key = orderDraftKey(order.storeId, order.id, false, "uid_test");
    saveOrderDraft(key, { orderUpdatedAt: order.updatedAt, savedAt: order.updatedAt, customerId: order.customerId, customerQuery: "Cliente Olivia", lines: [{ key: "saved", productName: "Pieza", productQuery: "Pieza", quantity: 1, quantityText: "1", unitPrice: 720, unitPriceText: "720", costText: "", subtotal: 720 }], deposit: "720", promisedDate: "", orderStatus: "asked", notes: "Nota recuperada" });
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    expect(screen.getByLabelText("Anticipo")).toHaveValue("590");
    expect(screen.getByLabelText("Notas")).toHaveValue("Nota recuperada");
  });
});

// #219 fase 1a: contrato de Notas — multilínea con acentos/ñ persiste idéntico.
describe("text-entry-audit · Notas (#219)", () => {
  it("preserves accents, ñ and line breaks exactly through save", async () => {
    localStorage.clear();
    const notas = "Aretes bañados — ajustar tamaño\nClienta pidió grabado: «Añoranza»\n  · entrega el sábado";
    const value = orderForNotes();
    const view = render(<ToastProvider><OrderForm order={value} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Notas" }), { target: { value: notas } });
    await screen.findByLabelText(/Precio unitario/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalled());
    // El flujo de guardado puede despachar más de una escritura (p. ej. la
    // confirmación del plan); el contrato es sobre la ÚLTIMA persistencia.
    const saved = mockUpsertOrder.mock.calls[mockUpsertOrder.mock.calls.length - 1][0];
    expect(saved.notes).toBe(notas);
    view.unmount(); // reabrir: solo el árbol del pedido persistido
    render(<ToastProvider><OrderForm order={saved} onDone={() => {}} /></ToastProvider>);
    expect(screen.getByRole("textbox", { name: "Notas" })).toHaveValue(notas);
  });

  function orderForNotes(): Order {
    return {
      id: "notas-219", storeId: "store_olivia", customerId: "customer_1",
      items: [{ productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
      deposit: 0, orderStatus: "asked", paymentStatus: "unpaid",
      createdAt: "2026-11-07", updatedAt: "2026-11-07",
    };
  }
});

describe("OrderForm #124 — venta por color exacto", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpsertOrder.mockClear();
    mockUpsertOrder.mockResolvedValue({});
    state.products = [
      {
        ...state.products[0],
        id: "design_1",
        name: "Anillo Sol",
        sku: "SOL",
        cost: 100,
        prices: { t_retail: 300 },
        categoryIds: ["c1"],
        quantityOnHand: undefined,
        variants: [
          { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 110, quantityOnHand: 2, photos: [], createdAt: "", updatedAt: "" },
          { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "SOL-P", cost: 90, quantityOnHand: 1, photos: [], createdAt: "", updatedAt: "" },
        ],
      } as unknown as typeof state.products[number],
    ];
    state.categories = [{ id: "c1", storeId: "store_olivia", name: "Anillos", active: true, createdAt: "", updatedAt: "" }] as unknown as typeof state.categories;
  });

  it("pedir el color: sin elección no guarda; con elección guarda color, clave y costo del color", async () => {
    const order = { id: "var-order", storeId: "store_olivia", customerId: "customer_1", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Anillo Sol" } });
    fireEvent.click(screen.getByRole("option", { name: /Anillo Sol/ }));
    // El selector de color aparece y es obligatorio.
    const colorSelect = await screen.findByLabelText("Color");
    expect(colorSelect).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    expect(await screen.findByText(/Elige el color del artículo 1/)).toBeTruthy();
    expect(mockUpsertOrder).not.toHaveBeenCalled();
    // Elegir Dorado adopta SU costo (110, no el 100 del diseño).
    fireEvent.change(colorSelect, { target: { value: "v_gold" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    const saved = mockUpsertOrder.mock.calls[0][0] as { items: Array<Record<string, unknown>> };
    expect(saved.items[0]).toMatchObject({ productId: "design_1", variantId: "v_gold", variantColor: "Dorado", variantSku: "SOL-D" });
  });

  it("un producto sin variantes no muestra selector de color", async () => {
    state.products = [{ ...state.products[0], id: "plain_1", name: "Collar Luna", variants: undefined } as typeof state.products[number]];
    const order = { id: "plain-order", storeId: "store_olivia", customerId: "customer_1", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Producto"), { target: { value: "Collar Luna" } });
    fireEvent.click(screen.getByRole("option", { name: /Collar Luna/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeTruthy());
    expect(screen.queryByLabelText("Color")).toBeNull();
  });
});

describe("OrderForm #271 — corrección firmada del anticipo", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpsertOrder.mockClear();
  });
  function evidenceOrder() {
    return {
      id: "lower-271",
      storeId: "store_olivia",
      customerId: "customer_1",
      items: [{ productName: "Anillo", quantity: 1, unitPrice: 50, subtotal: 50 }],
      deposit: 500,
      paymentsReceivedCents: 1000,
      paymentsRevision: 1,
      orderStatus: "asked" as const,
      paymentStatus: "unpaid" as const,
      schemaVersion: 2,
      revision: 3,
      createdAt: "",
      updatedAt: "",
    };
  }

  it("bajar el anticipo con cobros pide el motivo y no guarda sin él", async () => {
    mockUpsertOrder.mockResolvedValue({});
    render(<ToastProvider><OrderForm order={evidenceOrder()} onDone={() => {}} /></ToastProvider>);
    const anticipo = screen.getByLabelText("Anticipo") as HTMLInputElement;
    expect(anticipo.value).toBe("500");
    fireEvent.change(anticipo, { target: { value: "100" } });
    expect(await screen.findByText(/Estás bajando el anticipo de un pedido con cobros/)).toBeTruthy();
    expect(screen.getByLabelText("Motivo de la corrección del anticipo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    expect(await screen.findByText(/Escribe el motivo de la corrección del anticipo/)).toBeTruthy();
    expect(mockUpsertOrder).not.toHaveBeenCalled();
  });

  it("con el motivo guarda y viaja la nota firmada", async () => {
    mockUpsertOrder.mockResolvedValue({});
    render(<ToastProvider><OrderForm order={evidenceOrder()} onDone={() => {}} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Anticipo"), { target: { value: "100" } });
    fireEvent.change(await screen.findByLabelText("Motivo de la corrección del anticipo"), { target: { value: "Anticipo capturado por error: era $100" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    const options = mockUpsertOrder.mock.calls[0][1];
    expect(options.depositCorrectionNote).toBe("Anticipo capturado por error: era $100");
    expect((mockUpsertOrder.mock.calls[0][0] as { deposit: number }).deposit).toBe(100);
  });

  it("sin bajada no aparece el campo de motivo", () => {
    render(<ToastProvider><OrderForm order={evidenceOrder()} onDone={() => {}} /></ToastProvider>);
    expect(screen.queryByLabelText("Motivo de la corrección del anticipo")).toBeNull();
  });
});

describe("text-entry-audit · fase 1b (#219)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpsertOrder.mockClear();
    mockUpsertOrder.mockResolvedValue({});
  });

  it("fecha prometida: válida persiste, vacía se omite, basura no alcanza el estado (input date sanitiza)", async () => {
    const order = { id: "f1b-date", storeId: "store_olivia", customerId: "customer_1", items: [{ productName: "Pieza", quantity: 1, unitPrice: 50, subtotal: 50 }], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const view = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    const fecha = screen.getByLabelText("Fecha prometida") as HTMLInputElement;
    // Válida persiste tal cual.
    fireEvent.change(fecha, { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect((mockUpsertOrder.mock.calls[0][0] as { promisedDate?: string }).promisedDate).toBe("2026-11-20");
    // Vacía se omite (no viaja campo).
    mockUpsertOrder.mockClear();
    const fecha2 = screen.getByLabelText("Fecha prometida") as HTMLInputElement;
    fireEvent.change(fecha2, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    expect((mockUpsertOrder.mock.calls[0][0] as Record<string, unknown>).promisedDate).toBeUndefined();
    // Basura: el input date la sanitiza a "" — jamás llega al estado.
    mockUpsertOrder.mockClear();
    fireEvent.change(screen.getByLabelText("Fecha prometida"), { target: { value: "no-es-fecha" } });
    expect((screen.getByLabelText("Fecha prometida") as HTMLInputElement).value).toBe("");
    view.unmount();
  });

  it("producto libre: espacios extremos no se recortan al escribir, sí al guardar", async () => {
    const order = { id: "f1b-free", storeId: "store_olivia", customerId: "customer_1", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    const producto = screen.getByLabelText("Producto");
    fireEvent.change(producto, { target: { value: "  Aretes bañados  " } });
    // Mientras se escribe, el texto permanece tal cual (contrato: no recortar en captura).
    expect((screen.getByLabelText("Producto") as HTMLInputElement).value).toBe("  Aretes bañados  ");
    fireEvent.change(screen.getAllByLabelText(/^Cantidad$/)[0], { target: { value: "1" } });
    fireEvent.change(screen.getAllByLabelText(/Precio unitario/)[0], { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    const saved = mockUpsertOrder.mock.calls[0][0] as { items: Array<{ productName: string }> };
    expect(saved.items[0].productName).toBe("Aretes bañados"); // limpio al persistir
  });

  it("clienta por teléfono dictado (espacios, guiones, paréntesis) y nombre sin acentos: la búsqueda la encuentra (#219)", async () => {
    state.customers = [
      { ...state.customers[0], id: "c_phone", name: "María José Lucía", phone: "55 1234 5678" } as typeof state.customers[number],
    ];
    const order = { id: "f1b-phone", storeId: "store_olivia", customerId: "", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    const view = render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    const cliente = screen.getByLabelText("Cliente");
    // Guiones (el caso exacto de la misión: número dictado por WhatsApp).
    fireEvent.change(cliente, { target: { value: "55-1234 5678" } });
    expect(await screen.findByRole("option", { name: /María José Lucía/ })).toBeTruthy();
    // Paréntesis + guion, otra forma común de dictarlo.
    fireEvent.change(cliente, { target: { value: "(55) 1234-5678" } });
    expect(await screen.findByRole("option", { name: /María José Lucía/ })).toBeTruthy();
    // Nombre SIN acentos encuentra al guardado CON acentos.
    fireEvent.change(cliente, { target: { value: "maria jose" } });
    expect(await screen.findByRole("option", { name: /María José Lucía/ })).toBeTruthy();
    // Dirección inversa: teléfono guardado CON espacios, aguja apretada.
    fireEvent.change(cliente, { target: { value: "5512345678" } });
    expect(await screen.findByRole("option", { name: /María José Lucía/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /María José Lucía/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled());
    view.unmount();
  });

});

describe("text-entry-audit · flujo Clientas en Pedidos (#219)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpsertOrder.mockClear().mockResolvedValue({});
    state.customers = [];
  });

  it("el botón deshabilitado explica qué falta (clienta)", () => {
    const order = { id: "cli-hint", storeId: "store_olivia", customerId: "", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    expect(screen.getByText("Elige o crea una clienta para poder guardar.")).toBeTruthy();
  });

  it("«+ Nuevo cliente» precarga lo tecleado: número → teléfono; texto → nombre", () => {
    const order = { id: "cli-pre", storeId: "store_olivia", customerId: "", items: [], deposit: 0, orderStatus: "asked" as const, paymentStatus: "unpaid" as const, schemaVersion: 2, createdAt: "", updatedAt: "" };
    render(<ToastProvider><OrderForm order={order} onDone={() => {}} /></ToastProvider>);
    const cliente = screen.getByLabelText("Cliente");
    // Parece teléfono → precarga teléfono, no nombre.
    fireEvent.change(cliente, { target: { value: "55-1234 5678" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
    expect((screen.getByLabelText("Teléfono") as HTMLInputElement).value).toBe("55-1234 5678");
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("");
    // Cerrar el diálogo y repetir con texto → precarga nombre.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "María Nueva" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("María Nueva");
  });
});
