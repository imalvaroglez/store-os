// @vitest-environment jsdom
// #421: a captured article without a linked ficha does NOT reserve stock —
// the editor must say so and let Fer link the ficha (color included) keeping
// the agreed price and quantity; linking then reserves exactly once.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderForm } from "./OrderForm";
import type { Order, Product } from "../../types";

const mocks = vi.hoisted(() => ({
  state: {
    products: [] as Product[],
    categories: [],
    purchases: [],
    customers: [{ id: "c1", storeId: "store_olivia", name: "Sofía" }],
  },
  activeStore: { id: "store_olivia", name: "Olivia", type: "inventory_tiered", priceTiers: [{ id: "t_retail", label: "Menudeo", order: 1 }], defaultTierId: "t_retail" },
  upsertOrder: vi.fn(async (order: Order) => order),
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({ state: mocks.state, activeStore: mocks.activeStore, upsertOrder: mocks.upsertOrder, draftOwnerId: "uid_test" }),
  newCustomer: vi.fn(),
}));

const NOW = "2026-11-14T10:00:00.000Z";
const aro: Product = {
  id: "p_aro", storeId: "store_olivia", name: "Aro Luna", category: "other", isPublic: true, status: "published",
  prices: { t_retail: 300 }, quantityOnHand: 2, createdAt: NOW, updatedAt: NOW,
} as unknown as Product;

const unlinkedOrder: Order = {
  id: "o421", storeId: "store_olivia", customerId: "c1",
  items: [{ lineId: "o421_L0", productName: "Aro Luna", quantity: 1, unitPrice: 250, subtotal: 250 }], // capturado POR NOMBRE, sin ficha
  deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid",
  createdAt: NOW, updatedAt: NOW,
};

function renderForm(order?: Partial<Order> & { id?: string }) {
  // Each test gets its OWN order id: the form persists per-order drafts in
  // localStorage, and a shared id bleeds one test's capture into the next.
  const full: Order = { ...unlinkedOrder, ...order, id: order?.id ?? `o421-${Math.random().toString(36).slice(2, 8)}` } as Order;
  return render(<ToastProvider><OrderForm order={full} onDone={() => {}} /></ToastProvider>);
}

beforeEach(() => {
  localStorage.clear();
  mocks.state.products = [aro];
  mocks.upsertOrder.mockClear().mockImplementation(async (order: Order) => order);
});

describe("#421 renglón sin ficha en el editor de pedidos", () => {
  it("muestra el aviso «No aparta existencias» junto al artículo sin vincular", async () => {
    renderForm();
    expect(await screen.findByText(/No aparta existencias/i)).toBeTruthy();
  });

  it("vincular la ficha conserva cantidad y precio ACORDADO (no el precio de catálogo)", async () => {
    renderForm();
    const input = await screen.findByRole("combobox", { name: "Producto" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Aro Luna" } });
    fireEvent.click(await screen.findByRole("option", { name: /Aro Luna/ }));
    await waitFor(() => expect(screen.queryByText(/No aparta existencias/i)).toBeNull());
    // Precio acordado intacto (el catálogo diría $300; la clienta acordó $250).
    expect((screen.getByLabelText(/Precio unitario/i) as HTMLInputElement).value).toBe("250");
    expect((screen.getByLabelText(/Cantidad/i) as HTMLInputElement).value).toBe("1");
  });

  it("un renglón personalizado sigue capturándose igual (sin vínculo, con aviso)", async () => {
    renderForm();
    const input = await screen.findByRole("combobox", { name: "Producto" });
    fireEvent.change(input, { target: { value: "Grabado especial" } });
    expect(await screen.findByText(/No aparta existencias/i)).toBeTruthy(); // sigue visible: sin ficha
  });

  it("la ficha vinculada desaparece el aviso; guardar lleva el productId", async () => {
    renderForm();
    const input = await screen.findByRole("combobox", { name: "Producto" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Aro Luna" } });
    fireEvent.click(await screen.findByRole("option", { name: /Aro Luna/ }));
    await waitFor(() => expect(screen.queryByText(/No aparta existencias/i)).toBeNull());
    const priceInput = screen.getByLabelText(/Precio unitario/i) as HTMLInputElement;
    expect(priceInput.value).toBe("250"); // campo visible con el precio acordado
    fireEvent.click(await screen.findByRole("button", { name: /^Guardar/i }));
    await waitFor(() => expect(mocks.upsertOrder).toHaveBeenCalled());
    const saved = mocks.upsertOrder.mock.calls[mocks.upsertOrder.mock.calls.length - 1][0] as Order;
    expect(saved.items[0].productId).toBe("p_aro");
    expect(saved.items[0].unitPrice).toBe(250);
  });
});
