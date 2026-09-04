import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreProvider } from "./StoreProvider";
import { App } from "./App";
import { AuthProvider } from "./firebase/AuthProvider";
import { HomeScreen } from "../features/home/HomeScreen";
import { fixtureState } from "../lib/testFixtures";
import type { AppState } from "../types";
import { saveState } from "../lib/storage";
import { ToastProvider } from "../design-system";

// Runtime mount smoke: catches render-time crashes curl/static checks can't.
// AuthProvider uses the isolated unit-test adapter here; backend behavior is
// covered by the real-dev integration suite.
function withState(state: AppState) {
  saveState(state); // so the provider loads this exact state, not a fresh seed
  return ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>
      <StoreProvider>
        <ToastProvider>{children}</ToastProvider>
      </StoreProvider>
    </AuthProvider>
  );
}

// PublicCatalogScreen is Firestore-backed (anonymous public projection); its
// backend behavior is covered by the real-dev integration suite.

describe("HomeScreen store isolation render", () => {
  it("renders the active store's data and primary action", () => {
    const Wrapper = withState(fixtureState());
    render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );

    // Primary action present
    expect(screen.getByText("+ Nuevo pedido")).toBeTruthy();

    // Olivia is the active store in seed; her product appears in active orders.
    expect(screen.getByText("Anillo de plata 925")).toBeTruthy();

    // A Santi-only product must not leak onto the Olivia home screen.
    expect(screen.queryByText("Perfume Baccarat Rouge 540")).toBeNull();
  });

  it("isolates when switching active store via the provider", () => {
    const state = fixtureState();
    const joyeria = state.stores.find((s) => s.slug === "joyeria")!;
    state.activeStoreId = joyeria.id;
    const Wrapper = withState(state);
    const { container } = render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );
    // Joyería has inventory; low-stock banner text or product may appear.
    // The key assertion: Santi's on-demand product must not appear on Joyería home.
    expect(screen.queryByText("Perfume Baccarat Rouge 540")).toBeNull();
    expect(container.textContent).toContain("Joyería");
  });
});

describe("Root signed-out routing (production)", () => {
  it("shows AuthScreen when there is no session", () => {
    const original = import.meta.env.DEV;
    (import.meta.env as { DEV: boolean }).DEV = false;
    localStorage.clear(); // cold visitor: no persisted unit-test state
    try {
      // No session, no active store -> in a built deployment this must be AuthScreen.
      // The unit-test adapter has no Firebase session, so user stays null.
      render(
        <AuthProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </AuthProvider>
      );
      // AuthScreen renders its header subtitle.
      expect(screen.getByText("Sincroniza tus tiendas en la nube")).toBeTruthy();
      // Fixture stores must NOT appear without a session.
      expect(screen.queryByText("Joyería")).toBeNull();
    } finally {
      (import.meta.env as { DEV: boolean }).DEV = original;
      localStorage.clear();
    }
  });
});
