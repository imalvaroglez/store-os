// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProductForm } from "./ProductForm";
import { fixtureState } from "../../lib/testFixtures";
import type { AppUser } from "../../app/firebase/auth";
import type { Product } from "../../types";

const mocks = vi.hoisted(() => ({
  user: null as AppUser | null,
  state: null as ReturnType<typeof fixtureState> | null,
  upsertProduct: vi.fn(),
}));

vi.mock("../../app/firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: mocks.user,
    authReady: true,
    enabled: false,
    error: null,
    signOut: async () => {},
  }),
}));
vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      upsertProduct: mocks.upsertProduct,
      activeStore: mocks.state?.stores.find((s) => s.id === "store_olivia"),
      cloud: false,
    }),
  };
});

const product: Product = {
  id: "prod_olivia_1",
  storeId: "store_olivia",
  name: "Anillo de plata 925",
  category: "other",
  status: "published",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as Product;

beforeEach(() => {
  localStorage.clear();
  mocks.user = { uid: "uid_fer", email: "fer@olivia.mx", role: "member" };
  mocks.state = fixtureState();
  mocks.upsertProduct.mockReset();
  mocks.upsertProduct.mockResolvedValue(undefined);
});

describe("captura de dinero en ProductForm (#188)", () => {
  it("conserva el punto del costo mientras se escribe, tecla por tecla", () => {
    render(<ProductForm product={product} onDone={() => {}} />);
    // Tienda sin niveles en el fixture: precio único visible bajo "Precio de venta".
    const cost = screen.getByLabelText("Costo") as HTMLInputElement;
    for (const [typed, shown] of [
      ["1", "1"],
      ["12", "12"],
      ["12.", "12."],
      ["12.3", "12.3"],
      ["12.34", "12.34"],
    ] as const) {
      fireEvent.change(cost, { target: { value: typed } });
      expect(cost.value, `tras teclear "${typed}"`).toBe(shown);
    }
  });

  it("no deja residuo visible que al guardar se interpretaría como otro número", () => {
    render(<ProductForm product={product} onDone={() => {}} />);
    const cost = screen.getByLabelText("Costo") as HTMLInputElement;
    // "$12.5" pegado se ve como "12.5" en la casilla: lo visible es lo que se registra.
    fireEvent.change(cost, { target: { value: "$12.5" } });
    expect(cost.value).toBe("12.5");
  });
});
