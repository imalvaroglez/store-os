// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Button as DesignButton } from "../design-system";
import { StoreProvider, useStore } from "./StoreProvider";
import { fixtureState } from "../lib/testFixtures";

const mocks = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string; role: "member" | "super_admin" },
  loadCloudState: vi.fn(),
  subscribeCloudState: vi.fn(),
}));

vi.mock("./firebase/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user, authReady: true, enabled: true, error: null, signOut: async () => {} }),
}));

vi.mock("./firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./firebase/firestoreData")>();
  return {
    ...actual,
    loadCloudState: mocks.loadCloudState,
    subscribeCloudState: mocks.subscribeCloudState,
  };
});

function ProviderProbe() {
  const { state, addStore } = useStore();
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...newStore } = fixtureState().stores[0];
  return (
    <>
      <p>Tiendas cargadas: {state.stores.length}</p>
      <DesignButton onClick={async () => {
        try {
          await addStore(newStore);
        } catch (error) {
          document.getElementById("command-error")!.textContent = (error as Error).message;
        }
      }}>Crear tienda</DesignButton>
      <p id="command-error" role="alert" />
    </>
  );
}

describe("StoreProvider requiere sesión autenticada", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.user = null;
    mocks.loadCloudState.mockReset();
    mocks.subscribeCloudState.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("ignora el estado administrativo anterior y empieza vacío sin sesión", async () => {
    localStorage.setItem("store_os_state_v1", JSON.stringify(fixtureState()));
    const getItem = vi.spyOn(Storage.prototype, "getItem");

    render(<StoreProvider><ProviderProbe /></StoreProvider>);

    expect(screen.getByText("Tiendas cargadas: 0")).toBeTruthy();
    expect(getItem.mock.calls.some(([key]) => key === "store_os_state_v1")).toBe(false);
    expect(mocks.loadCloudState).not.toHaveBeenCalled();
    expect(localStorage.getItem("store_os_state_v1")).not.toBeNull();
  });

  it("rechaza comandos administrativos sin sesión y no cambia el estado", async () => {
    render(<StoreProvider><ProviderProbe /></StoreProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Crear tienda" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/inicia sesión/i));
    expect(screen.getByText("Tiendas cargadas: 0")).toBeTruthy();
    expect(mocks.loadCloudState).not.toHaveBeenCalled();
  });
});
