// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StoreProvider } from "./StoreProvider";
import { App } from "./App";
import { HomeScreen } from "../features/home/HomeScreen";
import { fixtureState } from "../lib/testFixtures";
import { ToastProvider } from "../design-system";
import type { AppState } from "../types";

const mocks = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string | null; role: "super_admin" | "member" },
  state: null as AppState | null,
  loadCloudState: vi.fn(),
}));

vi.mock("./firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ user: mocks.user, authReady: true, enabled: true, error: null, signOut: async () => {} }),
}));

vi.mock("./firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./firebase/firestoreData")>();
  return {
    ...actual,
    loadCloudState: mocks.loadCloudState,
    subscribeCloudState: vi.fn(() => () => {}),
    saveEntity: vi.fn(async () => {}),
    projectPublicForStore: vi.fn(async () => {}),
  };
});

const signedInUser = { uid: "uid_test", email: "test@store-os.mx", role: "super_admin" as const };

function withCloudState(state: AppState, user = signedInUser) {
  mocks.state = state;
  mocks.user = user;
  mocks.loadCloudState.mockImplementation(async () => state);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StoreProvider><ToastProvider>{children}</ToastProvider></StoreProvider>;
  };
}

beforeEach(() => {
  mocks.state = null;
  mocks.user = null;
  mocks.loadCloudState.mockReset();
  window.history.replaceState({}, "", "/");
});

describe("HomeScreen store isolation render", () => {
  it("renders the authenticated Firestore state and primary action", async () => {
    const Wrapper = withCloudState(fixtureState());
    render(<Wrapper><HomeScreen /></Wrapper>);

    await waitFor(() => expect(screen.getByText("+ Nuevo pedido")).toBeTruthy());
    expect(screen.getByText("Anillo de plata 925")).toBeTruthy();
    expect(screen.queryByText("Perfume Baccarat Rouge 540")).toBeNull();
  });

  it("isolates when the authenticated state selects another store", async () => {
    const state = fixtureState();
    const joyeria = state.stores.find((store) => store.slug === "joyeria")!;
    state.activeStoreId = joyeria.id;
    const Wrapper = withCloudState(state);
    const { container } = render(<Wrapper><HomeScreen /></Wrapper>);

    await waitFor(() => expect(container.textContent).toContain("Joyería"));
    expect(screen.queryByText("Perfume Baccarat Rouge 540")).toBeNull();
  });
});

describe("Root signed-out routing", () => {
  it("shows AuthScreen and never restores an administrative browser snapshot", () => {
    localStorage.setItem("store_os_state_v1", JSON.stringify(fixtureState()));
    render(<StoreProvider><App /></StoreProvider>);

    expect(screen.getByRole("heading", { name: "Entrar" })).toBeTruthy();
    expect(screen.queryByText("Joyería")).toBeNull();
    expect(mocks.loadCloudState).not.toHaveBeenCalled();
  });

  it("shows a retryable error when Firestore cannot load the signed-in user's state", async () => {
    mocks.user = signedInUser;
    mocks.loadCloudState.mockRejectedValue(new Error("network"));
    render(<StoreProvider><App /></StoreProvider>);

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(screen.queryByText("Crea tu primera tienda")).toBeNull();
  });
});
