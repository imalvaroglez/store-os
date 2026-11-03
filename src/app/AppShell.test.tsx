// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { StoreProvider } from "./StoreProvider";
import { fixtureState } from "../lib/testFixtures";
import { ToastProvider } from "../design-system";
import { ThemeProvider } from "../design-system/theme";

const mocks = vi.hoisted(() => ({
  user: { uid: "uid_fer", email: "fer@olivia.mx", role: "member" as "member" | "super_admin" },
  loadCloudState: vi.fn(),
}));
vi.mock("./firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: mocks.user,
    authReady: true,
    enabled: true,
    error: null,
    signOut: async () => {},
  }),
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

beforeEach(() => {
  const state = fixtureState();
  state.stores[0].ownerUid = mocks.user.uid;
  window.history.replaceState({}, "", "/productos");
  mocks.loadCloudState.mockReset();
  mocks.loadCloudState.mockImplementation(async () => state);
});

afterEach(() => {
  mocks.user = { uid: "uid_fer", email: "fer@olivia.mx", role: "member" };
});

describe("AppShell configuración de tienda", () => {
  it("abre Administrar tienda como vista propia y deja Opciones para cuenta/tema", async () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <StoreProvider>
            <AppShell />
          </StoreProvider>
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => expect(screen.getAllByText("Olivia").length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole("button", { name: "Tienda" })[0]);

    expect(screen.getByRole("heading", { name: "Administrar tienda" })).toBeTruthy();
    expect(screen.getByText("Teléfono de WhatsApp")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Opciones"));
    expect(screen.queryByRole("button", { name: "Administrar tienda" })).toBeNull();
    expect(screen.getByText("Tema")).toBeTruthy();
  });

  it("también permite administrar cualquier tienda a un superadministrador", async () => {
    mocks.user = { uid: "uid_admin", email: "admin@store.os", role: "super_admin" };
    const state = fixtureState();
    state.stores[0].ownerUid = "uid_fer";
    mocks.loadCloudState.mockImplementation(async () => state);

    render(
      <ThemeProvider>
        <ToastProvider>
          <StoreProvider>
            <AppShell />
          </StoreProvider>
        </ToastProvider>
      </ThemeProvider>
    );

    await waitFor(() => expect(screen.getAllByText("Olivia").length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole("button", { name: "Tienda" })[0]);

    expect(screen.getByText("Teléfono de WhatsApp")).toBeTruthy();
  });

  it("bloquea la ruta directa a un member que no es dueño", async () => {
    mocks.user = { uid: "uid_mar", email: "mar@olivia.mx", role: "member" };
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

    await waitFor(() => expect(screen.getByRole("heading", { name: "No tienes permiso" })).toBeTruthy());

    expect(screen.getByRole("heading", { name: "No tienes permiso" })).toBeTruthy();
    expect(screen.queryByText("Teléfono de WhatsApp")).toBeNull();
  });
});
