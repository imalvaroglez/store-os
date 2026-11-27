// @vitest-environment jsdom
// #559: the editor announces the prior debts of the clienta next to the new
// order's saldo (own file: the toast singleton carries state across suites).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderForm } from "./OrderForm";
import type { Order } from "../../types";

const { mockUpsertOrder, activeStore, state, navigate } = vi.hoisted(() => ({
  mockUpsertOrder: vi.fn().mockResolvedValue(undefined),
  activeStore: {
    id: "store_olivia",
    name: "Olivia",
    slug: "olivia",
    type: "inventory_tiered" as const,
    priceTiers: [{ id: "t_retail", label: "Iconic", order: 0 }],
    defaultTierId: "t_retail",
  },
  state: {
    products: [],
    categories: [],
    customers: [
      { id: "c_fer", storeId: "store_olivia", name: "Fer", createdAt: "", updatedAt: "" },
      { id: "c_otra", storeId: "store_olivia", name: "Otra", createdAt: "", updatedAt: "" },
    ],
    purchases: [],
    orders: [
      {
        id: "prior850",
        storeId: "store_olivia",
        customerId: "c_fer",
        customerName: "Fer",
        items: [{ lineId: "l1", productName: "Collar", quantity: 1, unitPrice: 850 }],
        paymentsReceivedCents: 75000,
        inheritedDepositMaterialized: true,
        deposit: 0,
        orderStatus: "confirmed",
        paymentStatus: "partial",
        createdAt: "2026-11-20T10:00:00Z",
        updatedAt: "2026-11-20T10:00:00Z",
      },
    ] as unknown as Order[],
  },
  navigate: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({ state, activeStore, upsertOrder: mockUpsertOrder, draftOwnerId: "uid_test" }),
  };
});
vi.mock("../../lib/router", () => ({ navigate }));

const newOrder: Order = {
  id: "nuevo-559",
  storeId: "store_olivia",
  customerId: "c_fer",
  customerName: "Fer",
  items: [{ productName: "Aretes", quantity: 1, unitPrice: 350, subtotal: 350 }],
  deposit: 0,
  orderStatus: "asked",
  paymentStatus: "unpaid",
  schemaVersion: 2,
  createdAt: "2026-11-26T10:00:00Z",
  updatedAt: "2026-11-26T10:00:00Z",
} as unknown as Order;

describe("#559 — the editor shows prior debts next to the saldo", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockResolvedValue(undefined);
    navigate.mockReset();
  });

  it("the reported case: $350 saldo, $100 adeudo anterior, $450 por cobrar en total", () => {
    render(<ToastProvider><OrderForm order={newOrder} isNew onDone={() => {}} /></ToastProvider>);
    // The sticky summary keeps THIS order's own saldo untouched (it also lives
    // in the mobile action bar — every copy stays $350)…
    expect(screen.getAllByText("Saldo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$350.00").length).toBeGreaterThanOrEqual(1);
    // …and next to it the prior debt with its total to collect.
    expect(screen.getByText("Adeudo anterior")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("Por cobrar en total")).toBeInTheDocument();
    expect(screen.getByText("$450.00")).toBeInTheDocument();
    // The editor's figures are the draft's — not yet synced.
    expect(screen.getByText(/sin guardar/)).toBeInTheDocument();
  });

  it("visits the order that originated the adeudo from the same journey", () => {
    render(<ToastProvider><OrderForm order={newOrder} isNew onDone={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByText(/Ver pedidos pendientes/));
    fireEvent.click(screen.getByRole("button", { name: /^Ver pedido$/ }));
    expect(navigate).toHaveBeenCalledWith("/pedidos/prior850");
  });

  it("follows a clienta change: Otra has no debts, the panel goes away", () => {
    const rendered = render(<ToastProvider><OrderForm order={newOrder} isNew onDone={() => {}} /></ToastProvider>);
    expect(screen.getByText("Adeudo anterior")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Busca por nombre o teléfono"), { target: { value: "Otra" } });
    // Lines already exist: the switch asks before applying prices — confirm it.
    fireEvent.click(screen.getByRole("button", { name: /Conservar importes/ }));
    expect(rendered.container.querySelector("[data-prior-debts]")).toBeNull();
  });
});
