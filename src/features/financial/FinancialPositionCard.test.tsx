// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { FinancialPositionCard } from "./FinancialPositionCard";
import type { LooseExpense, Purchase } from "../../types";

const mocks = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  register: vi.fn(async () => {}),
  financial: { status: "ready", activatedAt: "2026-11-01T00:00:00.000Z", cardPayments: [] as unknown as import("../../types").CardPayment[] } as { status: "idle" | "loading" | "ready" | "error"; activatedAt?: string; cardPayments: import("../../types").CardPayment[] },
  payments: [] as Array<{ id: string; orderId: string; storeId: string; date?: string; method: "cash"; kind: "payment"; amount: number; amountCents?: number; createdAt: string; createdBy: string }>,
  purchases: [] as Purchase[],
  expenses: [] as LooseExpense[],
}));

vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({
    state: { purchases: mocks.purchases, expenses: mocks.expenses },
    activeStore: { id: "s1", name: "Luna", type: "inventory_tiered" },
    payments: mocks.payments,
    financial: mocks.financial,
    loadFinancialPosition: mocks.load,
    registerCardPayment: mocks.register,
  }),
}));

const purchase = (extra: Partial<Purchase>): Purchase => ({
  id: "p1", storeId: "s1", date: "2026-11-03", lines: [], subtotal: 0, totalConfirmed: 0,
  createdAt: "", updatedAt: "", ...extra,
}) as Purchase;
const expense = (extra: Partial<LooseExpense>): LooseExpense => ({
  id: "e1", storeId: "s1", amount: 0, date: "2026-11-02", category: "operation", createdAt: "", updatedAt: "", ...extra,
}) as LooseExpense;

beforeEach(() => {
  mocks.financial = { status: "ready", activatedAt: "2026-11-01T00:00:00.000Z", cardPayments: [] };
  mocks.payments = [];
  mocks.purchases = [];
  mocks.expenses = [];
  mocks.register.mockClear();
});

describe("FinancialPositionCard (#279 frente 1)", () => {
  it("prueba de aceptación 2: compra $1,000 tarjeta + cobro $2,000 + pago $1,000 → deuda $0, caja $1,000", () => {
    mocks.payments = [{ id: "pay1", orderId: "o1", storeId: "s1", date: "2026-11-10", method: "cash", kind: "payment", amount: 2000, amountCents: 200000, createdAt: "", createdBy: "u" }];
    mocks.purchases = [purchase({ totalConfirmed: 1000, paymentMethod: "credit_card" })];
    mocks.financial = { status: "ready", activatedAt: "2026-11-01T00:00:00.000Z", cardPayments: [{ id: "cp1", storeId: "s1", date: "2026-11-20", amountCents: 100000, createdAt: "", createdBy: "u" }] };
    render(<ToastProvider><FinancialPositionCard /></ToastProvider>);
    expect(screen.getAllByText("$1,000.00").length).toBeGreaterThanOrEqual(1); // caja
    expect(screen.getAllByText("$0.00").length).toBe(2); // deuda tarjeta Y tercero en cero
    expect(screen.getByText(/registradas desde la activación/i)).toBeTruthy();
  });

  it("lo previo a la activación no cuenta: etiqueta de corte visible", () => {
    mocks.purchases = [purchase({ date: "2026-10-15", totalConfirmed: 500, paymentMethod: "credit_card" })];
    render(<ToastProvider><FinancialPositionCard /></ToastProvider>);
    expect(screen.getAllByText("$0.00").length).toBe(3); // caja, tarjeta y tercero: nada previo cuenta
    const cut = screen.getAllByText((_, element) => element?.tagName === "SPAN" && (element.textContent ?? "").startsWith("desde"));
    expect(cut.length).toBeGreaterThanOrEqual(1);
  });

  it("salidas sin forma de pago quedan visibles y fuera de las cifras", () => {
    mocks.expenses = [expense({ amount: 800 })];
    render(<ToastProvider><FinancialPositionCard /></ToastProvider>);
    expect(screen.getByText(/Salidas sin forma de pago/)).toBeTruthy();
  });

  it("registrar un pago de tarjeta llama a la acción con centavos exactos", async () => {
    render(<ToastProvider><FinancialPositionCard /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Pago de tarjeta" }));
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-11-21" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith({ amountCents: 50000, date: "2026-11-21" }));
  });

  it("error de carga con reintento, sin cifras inventadas", () => {
    mocks.financial = { status: "error", cardPayments: [] };
    render(<ToastProvider><FinancialPositionCard /></ToastProvider>);
    expect(screen.getByText(/No se pudo cargar la posición/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});
