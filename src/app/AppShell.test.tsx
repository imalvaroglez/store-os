// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { StoreProvider } from "./StoreProvider";
import { fixtureState } from "../lib/testFixtures";
import { saveState } from "../lib/storage";
import { ToastProvider } from "../design-system";
import { ThemeProvider } from "../design-system/theme";
import type { AppUser } from "./firebase/auth";

const authState: { user: AppUser } = { user: { uid: "uid_fer", email: "fer@olivia.mx", role: "member" } };
vi.mock("./firebase/config", () => ({
  isFirebaseConfigured: () => false,
  getFirebase: () => { throw new Error("Firebase no está configurado en esta prueba."); },
}));
vi.mock("./firebase/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    authReady: true,
    enabled: false,
    signOut: async () => {},
  }),
}));

beforeEach(() => {
  const state = fixtureState();
  state.stores[0].ownerUid = authState.user.uid;
  window.history.replaceState({}, "", "/productos");
  saveState(state);
});

describe("AppShell configuración de tienda", () => {
  it("abre Administrar tienda desde Opciones y muestra WhatsApp", () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <StoreProvider>
            <AppShell />
          </StoreProvider>
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByLabelText("Opciones"));
    fireEvent.click(screen.getByRole("button", { name: "Administrar tienda" }));

    expect(screen.getByRole("heading", { name: "Administrar tienda" })).toBeTruthy();
    expect(screen.getByText("Teléfono de WhatsApp")).toBeTruthy();
  });

  it("también permite administrar cualquier tienda a un superadministrador", () => {
    authState.user = { uid: "uid_admin", email: "admin@store.os", role: "super_admin" };
    const state = fixtureState();
    state.stores[0].ownerUid = "uid_fer";
    saveState(state);

    render(
      <ThemeProvider>
        <ToastProvider>
          <StoreProvider>
            <AppShell />
          </StoreProvider>
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByLabelText("Opciones"));
    fireEvent.click(screen.getByRole("button", { name: "Administrar tienda" }));

    expect(screen.getByText("Teléfono de WhatsApp")).toBeTruthy();
  });
});
