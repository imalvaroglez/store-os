// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../design-system";
import { ResellerRankingScreen } from "./ResellerRankingScreen";
import type { AppState, Customer, Order } from "../../types";

// #132 r2 (UX review return): the screen must be discoverable and HONEST —
// the tie notice may not promise a registration flow that does not exist.

const OLIVIA = "store_olivia";
const NOW = "2026-11-14T10:00:00.000Z";
const customer = (id: string, name: string, entrepreneur: boolean): Customer => ({
  id, storeId: OLIVIA, name, segment: entrepreneur ? "entrepreneur" : "regular",
  createdAt: NOW, updatedAt: NOW,
} as Customer);
const delivered = (id: string, customerId: string, cents: number, pieces: number): Order => ({
  id, storeId: OLIVIA, customerId,
  items: [{ lineId: "L0", productId: "p1", productName: "Pieza", quantity: pieces, unitPrice: cents / 100 / pieces, subtotal: cents / 100 }],
  deposit: 0, orderStatus: "delivered", paymentStatus: "paid",
  deliveries: [{ id: `d_${id}`, orderId: id, storeId: OLIVIA, deliveredAt: "2026-11-05", recordedAt: NOW, by: "u1", lines: [{ productId: "p1", quantity: pieces }] }],
  paymentsReceivedCents: cents,
  createdAt: NOW, updatedAt: NOW, schemaVersion: 2,
} as Order);

const mocks = vi.hoisted(() => ({ state: null as null | AppState }));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({
    state: mocks.state,
    activeStore: mocks.state?.stores.find((st) => st.id === mocks.state!.activeStoreId) ?? null,
  }),
}));

function baseState(orders: Order[], customers: Customer[]): AppState {
  return {
    stores: [{ id: OLIVIA, name: "Olivia", slug: "olivia", type: "inventory_tiered", ownerUid: "u1", memberUids: ["u1"], createdAt: NOW, updatedAt: NOW }],
    activeStoreId: OLIVIA, products: [], categories: [], customers, orders,
    suppliers: [], purchases: [], expenses: [], users: [], payments: [],
  } as unknown as AppState;
}

describe("#132 r2 — aviso de empate honesto y sin jerga", () => {
  it("el empate dice que el registro llega en etapa próxima — sin prometer un flujo inexistente", () => {
    mocks.state = baseState(
      [
        delivered("o1", "c_a", 100000, 2),
        delivered("o2", "c_b", 100000, 2),
      ],
      [customer("c_a", "Ana", true), customer("c_b", "Bety", true)]
    );
    render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    const notice = screen.getByText(/empate persistente/i);
    expect(notice.textContent).toMatch(/decide|decides/);
    expect(notice.textContent).toMatch(/etapa|después|aún no/);
    // La promesa rota de la ronda 1 («registra el motivo») ya no está.
    expect(notice.textContent).not.toMatch(/registra el motivo/);
  });

  it("el criterio del orden queda explicado en una sola línea — importe, luego piezas", () => {
    mocks.state = baseState([delivered("o1", "c_a", 100000, 2)], [customer("c_a", "Ana", true)]);
    render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    expect(screen.getByText(/mayor importe neto/i)).toBeTruthy();
    expect(screen.getByText(/más piezas/i)).toBeTruthy();
  });

  it("sin pie con jerga de issue (FER-17 / #132)", () => {
    mocks.state = baseState([delivered("o1", "c_a", 100000, 2)], [customer("c_a", "Ana", true)]);
    const { container } = render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    expect(container.textContent).not.toMatch(/FER-17|#132/);
  });
});
