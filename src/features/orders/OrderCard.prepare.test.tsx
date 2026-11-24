// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderCard } from "./OrderCard";
import { orderReference } from "../../lib/orders";
import type { Order } from "../../types";

// #539 (dictamen QA 23-nov): en la LISTA de Pedidos, «Preparar» avanzaba el
// pedido con un toque y sin confirmación — justo lo que la decisión del PO
// ataca en Inicio. La misma confirmación, el mismo contrato, en ambas superficies.

const { state, holder, toast } = vi.hoisted(() => ({
  state: { customers: [{ id: "c1", storeId: "s1", name: "Lucía Beltrán" }], products: [], purchases: [], orders: [] as Order[] },
  holder: { upsertOrder: vi.fn(), registerOrderPayment: vi.fn(), payments: [] },
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../design-system", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../design-system")>(),
  useToast: () => toast,
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({ upsertOrder: holder.upsertOrder, registerOrderPayment: holder.registerOrderPayment, activeStore: { name: "Joyería" }, state, payments: holder.payments, loadOrderPayments: async () => ({ payments: [], order: null }) }),
}));

const confirmed = (id = "ord-539-list"): Order => ({
  id, storeId: "s1", customerId: "c1", deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid",
  items: [
    { lineId: `${id}_l1`, productId: "p1", productName: "Anillo Sol", variantColor: "Dorado", quantity: 2, unitPrice: 400, subtotal: 800 },
    { lineId: `${id}_l2`, productId: "p1", productName: "Anillo Sol", variantColor: "Plateado", quantity: 1, unitPrice: 400, subtotal: 400 },
  ],
  createdAt: "2026-11-24T10:00:00Z", updatedAt: "2026-11-24T10:00:00Z",
} as Order);

const renderCard = (order: Order) => render(<OrderCard order={order} onEdit={() => {}} />);

describe("#539 «Preparar» en la lista de Pedidos confirma antes de avanzar", () => {
  // The dialog's confirm action only arms once it has settled — time is ours.
  let now = 1_700_000_000_000;
  const settle = () => { now += 1_000; };
  beforeEach(() => {
    now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    holder.upsertOrder.mockReset().mockResolvedValue({});
    toast.info.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("un toque en «Preparar» NO avanza el pedido: abre la confirmación con folio, piezas y clienta", () => {
    renderCard(confirmed());
    fireEvent.click(screen.getByRole("button", { name: "Preparar" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain(`#${orderReference("ord-539-list")}`); // el folio que la lista ya muestra
    expect(dialog.textContent).toContain("Anillo Sol");
    expect(dialog.textContent).toContain("Lucía Beltrán");
    expect(dialog.textContent).toMatch(/Confirmado a Preparando/);
    expect(holder.upsertOrder).not.toHaveBeenCalled(); // antes: avanzaba de inmediato
  });

  it("Cancelar deja el pedido intacto; «Preparar pedido» avanza sólo ese pedido", async () => {
    renderCard(confirmed());
    fireEvent.click(screen.getByRole("button", { name: "Preparar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(holder.upsertOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Preparar" }));
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Preparar pedido" }));
    await waitFor(() => expect(holder.upsertOrder).toHaveBeenCalledTimes(1));
    const saved = holder.upsertOrder.mock.calls[0][0] as Order;
    expect(saved.id).toBe("ord-539-list");
    expect(saved.orderStatus).toBe("preparing");
  });

  it("si el pedido cambió mientras la confirmación estaba abierta, muestra su estado y no avanza dos veces", async () => {
    const rendered = renderCard(confirmed());
    fireEvent.click(screen.getByRole("button", { name: "Preparar" }));
    // Otra sesión lo preparó mientras tanto.
    rendered.rerender(<OrderCard order={{ ...confirmed(), orderStatus: "preparing" } as Order} onEdit={() => {}} />);
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Preparar pedido" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(holder.upsertOrder).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("El pedido ya no está Confirmado: ahora está Preparando.");
  });

  it("un doble toque sobre «Preparar» no confirma: el diálogo ignora el toque que cae sobre «Preparar pedido» al abrirse", () => {
    renderCard(confirmed());
    fireEvent.click(screen.getByRole("button", { name: "Preparar" }));
    // El segundo toque de un doble toque cae donde acaba de aparecer «Preparar pedido».
    fireEvent.click(screen.getByRole("button", { name: "Preparar pedido" }));
    expect(holder.upsertOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy(); // sigue abierto: nada se confirma sin leerlo
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Preparar pedido" }));
    expect(holder.upsertOrder).toHaveBeenCalledTimes(1); // ya asentado, el mismo toque sí confirma
  });

  it("las demás acciones conservan su toque directo: «Marcar listo» no pide confirmación", async () => {
    renderCard({ ...confirmed(), orderStatus: "preparing" } as Order);
    fireEvent.click(screen.getByRole("button", { name: "Marcar listo" }));
    await waitFor(() => expect(holder.upsertOrder).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
