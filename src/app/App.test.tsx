import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreProvider } from "./StoreProvider";
import { App } from "./App";
import { AuthProvider } from "./firebase/AuthProvider";
import { HomeScreen } from "../features/home/HomeScreen";
import { buildSeedState } from "../lib/seed";
import { saveState } from "../lib/storage";

// Runtime mount smoke: catches render-time crashes curl/static checks can't.
// AuthProvider is in pure-local mode here (no VITE_FIREBASE_* in the test env),
// so StoreProvider stays on the localStorage path these tests expect.
function withState(state: ReturnType<typeof buildSeedState>) {
  saveState(state); // so the provider loads this exact state, not a fresh seed
  return ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>
      <StoreProvider>{children}</StoreProvider>
    </AuthProvider>
  );
}

// PublicCatalogScreen is now Firestore-backed (anonymous public projection),
// so its render behavior is covered by the emulator e2e suite
// (e2e/public-catalog.spec.ts), not this pure-local unit test.

describe("HomeScreen store isolation render", () => {
  it("renders the active store's data and primary action", () => {
    const Wrapper = withState(buildSeedState());
    render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );

    // Primary action present
    expect(screen.getByText("+ Nuevo pedido")).toBeTruthy();

    // Santi is the active store in seed; its product appears in active orders list
    expect(screen.getByText("Perfume Baccarat Rouge 540")).toBeTruthy();

    // A Joyería-only product must not leak onto the Santi home screen
    expect(screen.queryByText("Cadena de plata 925")).toBeNull();
  });

  it("isolates when switching active store via the provider", () => {
    const state = buildSeedState();
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
  it("shows AuthScreen, not the demo, when DEV is false and there is no session", () => {
    const original = import.meta.env.DEV;
    (import.meta.env as { DEV: boolean }).DEV = false;
    localStorage.clear(); // cold visitor: no demo seed in a built deployment
    try {
      // No session, no active store -> in a built deployment this must be AuthScreen.
      // AuthProvider is in pure-local mode (no VITE_FIREBASE_* here), so user stays null.
      render(
        <AuthProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </AuthProvider>
      );
      // AuthScreen renders its header subtitle.
      expect(screen.getByText("Sincroniza tus tiendas en la nube")).toBeTruthy();
      // The demo store must NOT appear.
      expect(screen.queryByText("Joyería")).toBeNull();
    } finally {
      (import.meta.env as { DEV: boolean }).DEV = original;
      localStorage.clear();
    }
  });
});
