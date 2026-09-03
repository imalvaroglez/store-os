// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  authState.user = { uid: "uid_fer", email: "fer@olivia.mx", role: "member" };
});

describe("AppShell configuración de tienda", () => {
  it("abre Administrar tienda como vista propia y deja Opciones para cuenta/tema", () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <StoreProvider>
            <AppShell />
          </StoreProvider>
        </ToastProvider>
      </ThemeProvider>
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Tienda" })[0]);

    expect(screen.getByRole("heading", { name: "Administrar tienda" })).toBeTruthy();
    expect(screen.getByText("Teléfono de WhatsApp")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Opciones"));
    expect(screen.queryByRole("button", { name: "Administrar tienda" })).toBeNull();
    expect(screen.getByText("Tema")).toBeTruthy();
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

    fireEvent.click(screen.getAllByRole("button", { name: "Tienda" })[0]);

    expect(screen.getByText("Teléfono de WhatsApp")).toBeTruthy();
  });

  it("bloquea la ruta directa a un member que no es dueño", () => {
    authState.user = { uid: "uid_mar", email: "mar@olivia.mx", role: "member" };
    window.history.replaceState({}, "", "/tienda/configuracion");

    render(
      <ThemeProvider>
        <ToastProvider>
          <StoreProvider>
            <AppShell />
          </StoreProvider>
        </ToastProvider>
      </ThemeProvider>
    );

    expect(screen.getByRole("heading", { name: "No tienes permiso" })).toBeTruthy();
    expect(screen.queryByText("Teléfono de WhatsApp")).toBeNull();
  });
});
