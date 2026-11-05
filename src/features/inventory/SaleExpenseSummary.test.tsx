// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { SaleExpenseSummary } from "./SaleExpenseSummary";
import { fixtureState } from "../../lib/testFixtures";
import type { AppUser } from "../../app/firebase/auth";
import type { AppState, Purchase } from "../../types";

const mocks = vi.hoisted(() => ({
  user: null as AppUser | null,
  state: null as AppState | null,
}));

vi.mock("../../app/firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: mocks.user, authReady: true, enabled: false, error: null, signOut: async () => {} }),
}));
vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === "store_olivia"),
    }),
  };
});

const purchase = (id: string, date: string): Purchase =>
  ({
    id,
    storeId: "store_olivia",
    date,
    lines: [],
    subtotal: 0,
    totalConfirmed: 0,
    sourcingExpenses: [
      { id: `${id}-delivery`, category: "customer_delivery", amount: 150.55, description: "Entrega Linda" },
      { id: `${id}-box`, category: "shared_packaging", amount: 80 },
    ],
    createdAt: date,
    updatedAt: date,
  }) as Purchase;

beforeEach(() => {
  localStorage.clear();
  mocks.user = { uid: "uid_fer", email: "fer@olivia.mx", role: "member" };
  const state = fixtureState();
  state.purchases = [purchase("p_nov", "2026-11-04"), purchase("p_oct", "2026-10-20")];
  mocks.state = state;
});

describe("SaleExpenseSummary (#184 corte ejecutable)", () => {
  it("muestra del mes en curso el desglose por categoría y el total exacto", () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T12:00:00") });
    render(<SaleExpenseSummary />);
    expect(screen.getByText("noviembre 2026")).toBeTruthy();
    expect(screen.getByText("Entrega a clienta")).toBeTruthy();
    // Categoría + línea de detalle (rastreable): el mismo dinero, dos vistas.
    expect(screen.getAllByText("$150.55")).toHaveLength(2);
    expect(screen.getAllByText("$80.00")).toHaveLength(2);
    expect(screen.getByText("$230.55")).toBeTruthy();
    vi.useRealTimers();
  });

  it("navega al mes anterior y vuelve con los totales de ese mes", () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T12:00:00") });
    render(<SaleExpenseSummary />);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(screen.getByText("octubre 2026")).toBeTruthy();
    expect(screen.getByText("$230.55")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(screen.getByText("noviembre 2026")).toBeTruthy();
    vi.useRealTimers();
  });

  it("un mes sin gastos muestra el aviso y ceros", () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T12:00:00") });
    render(<SaleExpenseSummary />);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(screen.getByText("septiembre 2026")).toBeTruthy();
    expect(screen.getByText("Sin gastos de venta en este periodo.")).toBeTruthy();
    vi.useRealTimers();
  });
});
