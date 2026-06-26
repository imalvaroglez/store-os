import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreProvider } from "./StoreProvider";
import { PublicCatalogScreen } from "../features/catalog/PublicCatalogScreen";
import { HomeScreen } from "../features/home/HomeScreen";
import { buildSeedState } from "../lib/seed";
import { saveState } from "../lib/storage";

// Runtime mount smoke: catches render-time crashes curl/static checks can't.
function withState(state: ReturnType<typeof buildSeedState>) {
  saveState(state); // so the provider loads this exact state, not a fresh seed
  return ({ children }: { children: React.ReactNode }) => (
    <StoreProvider>{children}</StoreProvider>
  );
}

describe("PublicCatalogScreen render", () => {
  it("renders only public products and hides private fields", () => {
    const Wrapper = withState(buildSeedState());
    render(
      <Wrapper>
        <PublicCatalogScreen slug="joyeria" />
      </Wrapper>
    );

    // Store header
    expect(screen.getByText("Joyería")).toBeTruthy();

    // Public product present
    expect(screen.getByText("Cadena de plata 925")).toBeTruthy();

    // Private product must NOT appear
    expect(screen.queryByText("Anillo grabado (privado)")).toBeNull();

    // Private/cost fields must never render
    expect(screen.queryByText(/Ganancia/)).toBeNull();
    expect(screen.queryByText(/Costo/)).toBeNull();

    // WhatsApp CTA present
    expect(screen.getAllByText("Pedir por WhatsApp").length).toBeGreaterThan(0);
  });

  it("shows not-found for an unknown slug", () => {
    const Wrapper = withState(buildSeedState());
    render(
      <Wrapper>
        <PublicCatalogScreen slug="no-existe" />
      </Wrapper>
    );
    expect(screen.getByText("Tienda no encontrada")).toBeTruthy();
  });
});

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
