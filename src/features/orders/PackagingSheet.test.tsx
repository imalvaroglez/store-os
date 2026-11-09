// @vitest-environment jsdom
// #253 — the order-prep packaging sheet: suggestions from per-line levels,
// one-tap consumption of linked supplies with orderId, per-line problems
// (missing/unavailable supply) instead of blocking the order.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PackagingSheet } from "./PackagingSheet";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { LooseExpense, Order } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  consumeSupply: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      consumeSupply: mocks.consumeSupply,
    }),
  };
});

const packaging = {
  materials: [
    { id: "m_bolsa", name: "Bolsa transparente", estimatedCost: 0.5, supplyExpenseId: "exp_bolsas" },
    { id: "m_rosa", name: "Bolsa rosa", estimatedCost: 3, supplyExpenseId: "exp_rosa" },
    { id: "m_mono", name: "Moño", estimatedCost: 0.43 },
  ],
  byTier: {
    t_iconic: {
      perPiece: [{ materialId: "m_bolsa", units: 1 }],
      perOrder: [
        { materialId: "m_rosa", units: 1 },
        { materialId: "m_mono", units: 1 },
      ],
    },
  },
};

function supplyExpense(id: string, quantityInitial: number, description: string): LooseExpense {
  return {
    id,
    storeId: "store_olivia",
    amount: 15,
    date: "2026-11-08",
    description,
    category: "supplies",
    supply: { quantityInitial, consumptions: [] },
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
}

function iconicOrder(quantity: number): Order {
  return {
    id: "order_pk",
    storeId: "store_olivia",
    customerId: "",
    items: [{ productName: "Anillo", quantity, unitPrice: 60, subtotal: 60 * quantity, priceTier: "t_iconic" }],
    deposit: 0,
    orderStatus: "preparing",
    paymentStatus: "unpaid",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  } as Order;
}

let state: ReturnType<typeof fixtureState>;

beforeEach(() => {
  state = fixtureState();
  mocks.state = state;
  const store = { ...state.stores[0] };
  store.priceTiers = [{ id: "t_iconic", label: "Iconic", order: 1 }];
  store.defaultTierId = "t_iconic";
  store.packaging = JSON.parse(JSON.stringify(packaging));
  state.stores[0] = store;
  mocks.consumeSupply.mockReset();
  mocks.consumeSupply.mockResolvedValue(undefined);
});

describe("PackagingSheet (#253)", () => {
  it("sugiere por pieza + set por pedido y consume los suministros vinculados con orderId", async () => {
    state.expenses.push(supplyExpense("exp_bolsas", 100, "Bolsas"));
    state.expenses.push(supplyExpense("exp_rosa", 10, "Bolsas rosa"));
    state.stores[0].packaging!.materials = state.stores[0].packaging!.materials.map((m) =>
      m.id === "m_mono" ? { ...m, supplyExpenseId: "exp_mono" } : m
    );
    state.expenses.push(supplyExpense("exp_mono", 96, "Moñitos"));
    render(<ToastProvider><PackagingSheet order={iconicOrder(4)} onClose={() => {}} /></ToastProvider>);
    expect(screen.getByText("Bolsa transparente")).toBeTruthy();
    const bolsas = screen.getByDisplayValue("4");
    expect(bolsas).toBeTruthy();
    expect(screen.getAllByDisplayValue("1")).toHaveLength(2); // rosa ×1 y moño ×1
    fireEvent.click(screen.getByRole("button", { name: "Consumir materiales" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/Consumo registrado/)).toBeTruthy();
    expect(mocks.consumeSupply).toHaveBeenCalledTimes(3);
    const calls = mocks.consumeSupply.mock.calls;
    expect(calls[0][1]).toMatchObject({ quantity: 4, orderId: "order_pk" });
    expect(calls[1][1]).toMatchObject({ quantity: 1, orderId: "order_pk" });
    expect(calls[2][1]).toMatchObject({ quantity: 1, orderId: "order_pk" }); // moño
  });

  it("disponible insuficiente: ese material queda marcado y los demás sí se consumen", async () => {
    state.expenses.push(supplyExpense("exp_bolsas", 2, "Bolsas")); // sugerencia pide 4
    state.expenses.push(supplyExpense("exp_rosa", 10, "Bolsas rosa"));
    render(<ToastProvider><PackagingSheet order={iconicOrder(4)} onClose={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Consumir materiales" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/no se pudieron consumir/)).toBeTruthy();
    expect(screen.getByText("solo hay 2 disponibles")).toBeTruthy();
    expect(mocks.consumeSupply).toHaveBeenCalledTimes(1); // solo la rosa
    expect(mocks.consumeSupply.mock.calls[0][1]).toMatchObject({ quantity: 1 });
  });

  it("material sin suministro vinculado: se lista como estimado y no se consume", async () => {
    state.expenses.push(supplyExpense("exp_bolsas", 100, "Bolsas"));
    state.expenses.push(supplyExpense("exp_rosa", 10, "Bolsas rosa"));
    render(<ToastProvider><PackagingSheet order={iconicOrder(2)} onClose={() => {}} /></ToastProvider>);
    expect(screen.getByText(/\(sin suministro\)/)).toBeTruthy(); // hint del moño antes de consumir
    fireEvent.click(screen.getByRole("button", { name: "Consumir materiales" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/no se pudieron consumir/)).toBeTruthy();
    // Bolsa y rosa se consumen; el moño (sin vincular) queda como problema listado.
    expect(mocks.consumeSupply).toHaveBeenCalledTimes(2);
    expect(screen.getByText("sin suministro vinculado (solo estimado)")).toBeTruthy();
  });

  it("sin empaques configurados: mensaje que guía a la configuración", () => {
    const state = mocks.state!;
    state.stores[0] = { ...state.stores[0], packaging: undefined };
    render(<ToastProvider><PackagingSheet order={iconicOrder(3)} onClose={() => {}} /></ToastProvider>);
    expect(screen.getByText(/Productos → Empaques/)).toBeTruthy();
  });
});
