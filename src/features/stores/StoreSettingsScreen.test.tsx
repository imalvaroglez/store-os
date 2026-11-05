// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StoreSettingsScreen } from "./StoreSettingsScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { AppUser } from "../../app/firebase/auth";

const mocks = vi.hoisted(() => ({
  user: null as AppUser | null,
  state: null as ReturnType<typeof fixtureState> | null,
  updateStore: vi.fn(),
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
      updateStore: mocks.updateStore,
      deleteStore: vi.fn(),
      inviteMember: vi.fn(),
      removeMember: vi.fn(),
      transferStoreOwnership: vi.fn(),
      republishCatalog: vi.fn(),
      setActiveStore: vi.fn(),
    }),
  };
});

const superAdmin: AppUser = { uid: "uid_root", email: "admin@store.os", role: "super_admin" };

beforeEach(() => {
  localStorage.clear();
  mocks.user = superAdmin;
  mocks.state = fixtureState();
  mocks.updateStore.mockReset();
  mocks.updateStore.mockResolvedValue(undefined);
});

describe("mínimos de nivel: captura de decimales (#188)", () => {
  it("conserva el punto del mínimo de compra mientras se escribe, tecla por tecla", () => {
    render(<ToastProvider><StoreSettingsScreen storeId="store_olivia" /></ToastProvider>);
    const min = screen.getByLabelText(/Mínimo de compra/) as HTMLInputElement;
    for (const [typed, shown] of [
      ["1", "1"],
      ["12", "12"],
      ["12.", "12."],
      ["12.3", "12.3"],
      ["12.34", "12.34"],
    ] as const) {
      fireEvent.change(min, { target: { value: typed } });
      expect(min.value, `tras teclear "${typed}"`).toBe(shown);
    }
  });

  it("un mínimo con punto al guardar se registra como entero y la casilla lo refleja", async () => {
    render(<ToastProvider><StoreSettingsScreen storeId="store_olivia" /></ToastProvider>);
    const min = screen.getByLabelText(/Mínimo de compra/) as HTMLInputElement;
    fireEvent.change(min, { target: { value: "1000.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar niveles" }));
    await waitFor(() => expect(mocks.updateStore).toHaveBeenCalled());
    const tiers = mocks.updateStore.mock.calls[0][0].priceTiers;
    // Los mínimos siguen siendo enteros no negativos (regla F4): lo visible al
    // guardar es lo que se registra, sin convertir 1000.50 en 100050.
    expect(tiers[0].minAmount).toBe(1000);
    expect((screen.getByLabelText(/Mínimo de compra/) as HTMLInputElement).value).toBe("1000");
  });

  it("el mínimo de piezas no admite punto y no corrompe los dígitos", () => {
    render(<ToastProvider><StoreSettingsScreen storeId="store_olivia" /></ToastProvider>);
    const pieces = screen.getByLabelText(/Mínimo de piezas/) as HTMLInputElement;
    fireEvent.change(pieces, { target: { value: "5." } });
    expect(pieces.value).toBe("5");
    fireEvent.change(pieces, { target: { value: "53" } });
    expect(pieces.value).toBe("53");
  });

  it("borrar el mínimo guarda la ausencia de mínimo (undefined)", async () => {
    render(<ToastProvider><StoreSettingsScreen storeId="store_olivia" /></ToastProvider>);
    const min = screen.getByLabelText(/Mínimo de compra/) as HTMLInputElement;
    fireEvent.change(min, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar niveles" }));
    await waitFor(() => expect(mocks.updateStore).toHaveBeenCalled());
    const tiers = mocks.updateStore.mock.calls[0][0].priceTiers;
    expect(tiers[0].minAmount).toBeUndefined();
  });
});
