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
