// @vitest-environment jsdom
// #559: the prior-debts breakdown next to the order saldo — the operator
// sees how much is THIS order, how much comes from BEFORE, the total to
// collect and which order originated each adeudo.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriorDebtsPanel } from "./PriorDebtsPanel";
import type { Order } from "../../types";

const { state } = vi.hoisted(() => ({ state: { orders: [] as Order[] } }));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ state }) }));

/** total/received in pesos, exact cents under the doc accumulator. */
function priced(id: string, total: number, received: number, createdAt: string, extra: Partial<Order> = {}): Order {
  return {
    id,
    storeId: "s1",
    customerId: "c1",
    customerName: "Fer",
    createdAt,
    updatedAt: createdAt,
    items: [{ lineId: "l1", productName: "Pieza", quantity: 1, unitPrice: total } as Order["items"][number]],
    paymentsReceivedCents: Math.round(received * 100),
    inheritedDepositMaterialized: true,
    deposit: 0,
    orderStatus: "confirmed",
    paymentStatus: "partial",
    ...extra,
  } as Order;
}

const prior = priced("prior850", 850, 750, "2026-11-20T10:00:00Z"); // the reported case: $100 owed

function renderPanel(props: Partial<Parameters<typeof PriorDebtsPanel>[0]> = {}) {
  return render(
    <PriorDebtsPanel
      storeId="s1"
      customerId="c1"
      currentOrderId="nuevo"
      currentPendingCents={35000}
      onVisitOrder={() => {}}
      {...props}
    />,
  );
}

describe("PriorDebtsPanel (#559)", () => {
  beforeEach(() => {
    state.orders = [prior];
  });

  it("shows the reported case: $350 saldo + $100 adeudo anterior = $450 por cobrar en total", () => {
    renderPanel();
    expect(screen.getByText("Adeudo anterior")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("Por cobrar en total")).toBeInTheDocument();
    expect(screen.getByText("$450.00")).toBeInTheDocument();
    // This order's own saldo stays where it was — the panel adds, never moves.
    expect(screen.queryByText("$350.00")).toBeNull();
  });

  it("links to the order that originated the adeudo (expanded list)", () => {
    const onVisitOrder = vi.fn();
    renderPanel({ onVisitOrder, expanded: true });
    fireEvent.click(screen.getByRole("button", { name: /Ver pedido/ }));
    expect(onVisitOrder).toHaveBeenCalledWith("prior850");
  });

  it("keeps the per-order list collapsed until asked (editor compactness)", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /^Ver pedido$/ })).toBeNull();
    expect(screen.getByText(/Ver pedidos pendientes/)).toBeInTheDocument();
  });

  it("lists several prior debts once each", () => {
    state.orders = [prior, priced("older", 200, 0, "2026-11-18T10:00:00Z")];
    renderPanel({ expanded: true });
    expect(screen.getByText("$300.00")).toBeInTheDocument(); // 100 + 200
    expect(screen.getByText("$650.00")).toBeInTheDocument(); // 350 + 300
    expect(screen.getAllByRole("button", { name: /^Ver pedido$/ })).toHaveLength(2);
  });

  it("nets her available credit once (#189) and explains the discount", () => {
    state.orders = [prior, priced("favor", 100, 115, "2026-11-01T10:00:00Z")]; // credit $15
    renderPanel();
    expect(screen.getByText("$435.00")).toBeInTheDocument(); // 350 + 100 − 15
    expect(screen.getByText(/saldo a favor disponible de/)).toBeInTheDocument();
    expect(screen.getByText("$15.00")).toBeInTheDocument();
  });

  it("shows the total with the credit discount even without prior debts", () => {
    state.orders = [priced("favor", 100, 115, "2026-11-01T10:00:00Z")];
    renderPanel();
    expect(screen.queryByText("Adeudo anterior")).toBeNull();
    expect(screen.getByText("$335.00")).toBeInTheDocument(); // 350 − 15
  });

  it("marks leftover credit when it covers everything", () => {
    state.orders = [priced("favor", 400, 1000, "2026-11-01T10:00:00Z")]; // credit $600
    renderPanel();
    expect(screen.getByText("$0.00")).toBeInTheDocument(); // 350 − 600, floored
    expect(screen.getByText(/quedaría/)).toBeInTheDocument();
    expect(screen.getByText("$250.00")).toBeInTheDocument();
  });

  it("distinguishes the draft's pending-sync figures from the definitive ones", () => {
    renderPanel({ pendingSync: true });
    expect(screen.getByText(/sin guardar/)).toBeInTheDocument();
  });

  it("hides when there is nothing cross-order to say", () => {
    state.orders = [priced("paid", 300, 300, "2026-11-19T10:00:00Z")];
    const { container } = renderPanel();
    expect(container.querySelector("[data-prior-debts]")).toBeNull();
  });

  it("hides without a clienta (editor cleared the pick)", () => {
    const { container } = renderPanel({ customerId: undefined });
    expect(container.querySelector("[data-prior-debts]")).toBeNull();
  });

  it("follows a clienta change: another clienta's debts are not hers", () => {
    state.orders = [prior, { ...priced("otra", 900, 0, "2026-11-21T10:00:00Z"), customerId: "c2" }];
    const { rerender } = renderPanel();
    expect(screen.getByText("$450.00")).toBeInTheDocument();
    rerender(
      <PriorDebtsPanel
        storeId="s1"
        customerId="c2"
        currentOrderId="nuevo"
        currentPendingCents={35000}
        onVisitOrder={() => {}}
      />,
    );
    expect(screen.getByText("$900.00")).toBeInTheDocument(); // only c2's debt
    expect(screen.getByText("$1,250.00")).toBeInTheDocument(); // 350 + 900
  });
});
