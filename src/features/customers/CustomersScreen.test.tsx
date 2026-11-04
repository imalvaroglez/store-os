// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StoreProvider } from "../../app/StoreProvider";
import { AuthProvider } from "../../app/firebase/AuthProvider";
import { ToastProvider } from "../../design-system";
import { CustomersScreen } from "./CustomersScreen";
import { fixtureState } from "../../lib/testFixtures";
import { saveState } from "../../lib/storage";
import type { AppState, Customer, Order } from "../../types";

// FER-05 panel visibility: the Clientes screen must answer "quién está Iconic,
// hasta cuándo" and open with the renewal alert — nothing more, no external
// notifications. Same mount pattern as CatalogScreen.test.tsx (local state,
// no Firebase configured in tests).

const OLIVIA = "store_olivia";
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

const customer = (id: string, name: string, storeId = OLIVIA): Customer => ({
  id, storeId, name, createdAt: daysAgo(90), updatedAt: daysAgo(90),
});

// A LIQUIDATED order above $1,000 at `daysAgo` (money is the event, PO 2026-11-03).
const qualifyingOrder = (id: string, customerId: string, days: number, storeId = OLIVIA): Order => ({
  id, storeId, customerId,
  items: [{ lineId: "L0", productName: "Collar", quantity: 2, unitPrice: 600, subtotal: 1200 }],
  deposit: 0, orderStatus: "delivered", paymentStatus: "paid",
  paymentsReceivedCents: 120000,
  createdAt: daysAgo(days), updatedAt: daysAgo(days), schemaVersion: 2,
});

function renderClientes(state: AppState) {
  saveState(state);
  return render(
    <AuthProvider>
      <StoreProvider>
        <ToastProvider>
          <CustomersScreen />
        </ToastProvider>
      </StoreProvider>
    </AuthProvider>
  );
}

/** The name's h3 → its .min-w-0 block, which also holds the Iconic badge. */
function customerBlock(name: string) {
  return screen.getByText(name).parentElement!;
}

beforeEach(() => {
  localStorage.clear();
});

describe("Clientes · vigencia Iconic", () => {
  it("abre con el aviso de renovación próxima y muestra la vigencia por clienta", () => {
    const state = fixtureState();
    state.customers = [...state.customers, customer("cust_mar", "Mar"), customer("cust_ana", "Ana")];
    // Activated 25 days ago → expires in 5 days → inside the 7-day notice.
    state.orders = [...state.orders, qualifyingOrder("o_mar", "cust_mar", 25)];
    renderClientes(state);

    expect(screen.getByText("⏳ Renovación próxima de Iconic")).toBeTruthy();
    expect(screen.getByText(/Mar · vence/, { selector: "span" })).toBeTruthy();
    expect(within(customerBlock("Mar")).getByText(/Iconic · vence/, { selector: "span" })).toBeTruthy();
    // Ana has no Iconic history: no badge, and she is not in the alert.
    expect(within(customerBlock("Ana")).queryByText(/Iconic/, { selector: "span" })).toBeNull();
  });

  it("sin clientas Iconic no hay aviso ni insignias", () => {
    const state = fixtureState();
    state.customers = [...state.customers, customer("cust_ana", "Ana")];
    // A small order (below $1,000) never qualifies.
    state.orders = [...state.orders, {
      ...qualifyingOrder("o_small", "cust_ana", 3),
      items: [{ lineId: "L0", productName: "Aretes", quantity: 1, unitPrice: 350, subtotal: 350 }],
    }];
    renderClientes(state);

    expect(screen.queryByText("⏳ Renovación próxima de Iconic")).toBeNull();
    expect(within(customerBlock("Ana")).queryByText(/Iconic/, { selector: "span" })).toBeNull();
  });

  it("aisla por tienda: un pedido grande de otra tienda no activa nada aquí", () => {
    const state = fixtureState();
    state.customers = [...state.customers, customer("cust_mar", "Mar")];
    // Same customerId, but the order belongs to Joyería.
    state.orders = [...state.orders, qualifyingOrder("o_foreign", "cust_mar", 25, "store_joyeria")];
    renderClientes(state);

    expect(screen.queryByText("⏳ Renovación próxima de Iconic")).toBeNull();
    expect(within(customerBlock("Mar")).queryByText(/Iconic/, { selector: "span" })).toBeNull();
  });
});
