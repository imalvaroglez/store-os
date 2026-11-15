// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const delivered = (id: string, customerId: string, cents: number, pieces: number, deliveredAt = "2026-11-05"): Order => ({
  id, storeId: OLIVIA, customerId,
  items: [{ lineId: "L0", productId: "p1", productName: "Pieza", quantity: pieces, unitPrice: cents / 100 / pieces, subtotal: cents / 100 }],
  deposit: 0, orderStatus: "delivered", paymentStatus: "paid",
  deliveries: [{ id: `d_${id}`, orderId: id, storeId: OLIVIA, deliveredAt, recordedAt: NOW, by: "u1", lines: [{ productId: "p1", quantity: pieces }] }],
  paymentsReceivedCents: cents,
  createdAt: NOW, updatedAt: NOW, schemaVersion: 2,
} as Order);

const mocks = vi.hoisted(() => ({
  state: null as null | AppState,
  confirmation: null as null | Record<string, unknown>,
  confirmRanking: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({
    state: mocks.state,
    activeStore: mocks.state?.stores.find((st) => st.id === mocks.state!.activeStoreId) ?? null,
    confirmRanking: mocks.confirmRanking,
  }),
}));
vi.mock("../../app/firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/firebase/firestoreData")>();
  return {
    ...actual,
    loadRankingConfirmation: vi.fn(async () => mocks.confirmation as never),
  };
});

beforeEach(() => {
  mocks.confirmation = null;
  mocks.confirmRanking.mockClear().mockResolvedValue(undefined);
});

function baseState(orders: Order[], customers: Customer[]): AppState {
  return {
    stores: [{ id: OLIVIA, name: "Olivia", slug: "olivia", type: "inventory_tiered", ownerUid: "u1", memberUids: ["u1"], createdAt: NOW, updatedAt: NOW }],
    activeStoreId: OLIVIA, products: [], categories: [], customers, orders,
    suppliers: [], purchases: [], expenses: [], users: [], payments: [],
  } as unknown as AppState;
}

describe("#132 r2 — aviso de empate honesto y sin jerga", () => {
  it("r3 FLUJO: mes cerrado con empate exige motivo y confirma; el resultado queda congelado con autor", async () => {
    mocks.state = baseState(
      [
        delivered("o1", "c_a", 100000, 2, "2026-10-05"),
        delivered("o2", "c_b", 100000, 2, "2026-10-06"),
      ],
      [customer("c_a", "Ana", true), customer("c_b", "Bety", true)]
    );
    render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await screen.findByLabelText(/Motivo del empate de Ana y Bety/);
    // Sin motivo: rechaza y NO confirma nada.
    fireEvent.click(screen.getByRole("button", { name: /Confirmar resultado del mes/ }));
    await waitFor(() => expect(screen.getByText(/Registra el motivo de cada empate antes de confirmar/)).toBeTruthy());
    expect(mocks.confirmRanking).not.toHaveBeenCalled();
    // Con el motivo: confirma y registra la resolución con las empatadas.
    fireEvent.change(screen.getByLabelText(/Motivo del empate de Ana y Bety/), { target: { value: "Mayor antigüedad como emprendedora" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar resultado del mes/ }));
    await waitFor(() => expect(mocks.confirmRanking).toHaveBeenCalledWith(expect.objectContaining({
      tieResolutions: [expect.objectContaining({ customerIds: ["c_a", "c_b"], motive: "Mayor antigüedad como emprendedora" })],
    })));
  });

  it("r3 FLUJO: mes cerrado SIN empate confirma en un toque y muestra el resultado congelado", async () => {
    mocks.state = baseState(
      [
        delivered("o1", "c_a", 100000, 2, "2026-10-05"),
        delivered("o2", "c_b", 60000, 1, "2026-10-06"),
      ],
      [customer("c_a", "Ana", true), customer("c_b", "Bety", true)]
    );
    render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await screen.findByText(/Confirmar resultado del mes/);
    fireEvent.click(screen.getByRole("button", { name: /Confirmar resultado del mes/ }));
    await waitFor(() => expect(mocks.confirmRanking).toHaveBeenCalledWith(expect.objectContaining({
      year: expect.any(Number), month: expect.any(Number),
      entries: expect.arrayContaining([expect.objectContaining({ customerId: "c_a", rank: 1 })]),
      tieResolutions: [],
    })));
    await waitFor(() => expect(screen.getByText(/Resultado confirmado/i)).toBeTruthy());
  });

  it("r3 FLUJO: mes ya confirmado muestra el congelado y la devolución tardía exige motivo de decisión excepcional", async () => {
    mocks.state = baseState(
      [delivered("o1", "c_a", 100000, 2, "2026-10-05")],
      [customer("c_a", "Ana", true)]
    );
    mocks.confirmation = {
      id: "store_olivia__2026-10", storeId: OLIVIA, year: 2026, month: 10, revision: 1,
      entries: [{ customerId: "c_a", name: "Ana", netCents: 100000, pieces: 2, rank: 1 }],
      tieResolutions: [], confirmedBy: "u1", confirmedByEmail: "fer@example.com", confirmedAt: "2026-11-02T10:00:00.000Z",
    };
    render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    // El resultado congelado con autor y fecha.
    await waitFor(() => expect(screen.getByText(/Confirmado por fer@example.com/)).toBeTruthy());
    // La recomputación coincide (sin devolución tardía): sin aviso.
    expect(screen.queryByText(/devolución posterior cambió/)).toBeNull();
  });

  it("r3 (revisión MAYOR): empate en la FRONTERA del top 3 — la 4ª empatada es visible y el aviso nombra a las dos", () => {
    mocks.state = baseState(
      [
        delivered("o1", "c_a", 300000, 5),
        delivered("o2", "c_b", 200000, 4),
        delivered("o3", "c_c", 100000, 2),
        delivered("o4", "c_d", 100000, 2), // empate exacto con Caro en la frontera 3-4
        delivered("o5", "c_e", 50000, 1),  // fuera del top, sin empate
      ],
      [
        customer("c_a", "Ana", true),
        customer("c_b", "Bety", true),
        customer("c_c", "Caro", true),
        customer("c_d", "Diana", true),
        customer("c_e", "Elena", true),
      ]
    );
    render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    // El podio se EXTIENDE: las 4 visibles (3 + la empatada en frontera) y la 5ª fuera.
    expect(screen.getAllByText(/Diana/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Elena/)).toBeNull();
    // El aviso nombra a las empatadas del podio.
    expect(screen.getByText(/Caro y Diana empatan/)).toBeTruthy();
  });

  it("el aviso de empate remite al registro con motivo al confirmar (el flujo existe)", () => {
    mocks.state = baseState(
      [
        delivered("o1", "c_a", 100000, 2),
        delivered("o2", "c_b", 100000, 2),
      ],
      [customer("c_a", "Ana", true), customer("c_b", "Bety", true)]
    );
    render(<ToastProvider><ResellerRankingScreen /></ToastProvider>);
    const notice = screen.getByText(/empatan con el mismo importe/i);
    expect(notice.textContent).toMatch(/decide|decides/);
    // r3: el registro con motivo YA EXISTE — el aviso remite a la confirmación.
    expect(notice.textContent).toMatch(/se registra con tu motivo al confirmar/);
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
