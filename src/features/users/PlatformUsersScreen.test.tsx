// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatPlatformUserDate, PlatformUsersScreen } from "./PlatformUsersScreen";

const mocks = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => "users-collection"),
  getDocs: mocks.getDocs,
}));
vi.mock("../../app/firebase/config", () => ({ getFirebase: () => ({ db: "test-db" }) }));

beforeEach(() => mocks.getDocs.mockReset());

describe("PlatformUsersScreen", () => {
  it("lista usuarios para super_admin y filtra por correo sin distinguir mayúsculas", async () => {
    mocks.getDocs.mockResolvedValue({ docs: [
      { id: "u1", data: () => ({ email: "ana@example.com", displayName: "Ana", role: "member", createdAt: { toDate: () => new Date("2026-01-15T12:00:00Z") } }) },
      { id: "u2", data: () => ({ email: "admin@store.os", role: "super_admin" }) },
    ] });
    render(<PlatformUsersScreen userRole="super_admin" />);

    expect(await screen.findByText("Ana")).toBeTruthy();
    expect(screen.getByText("Administración")).toBeTruthy();
    expect(screen.getByText("Miembro")).toBeTruthy();
    expect(screen.getByText(/Creada:.*2026/)).toBeTruthy();
    expect(screen.getAllByTestId("user-card")).toHaveLength(2);

    fireEvent.change(screen.getByRole("textbox", { name: "Buscar usuarios" }), { target: { value: "ANA@" } });
    expect(screen.getAllByTestId("user-card")).toHaveLength(1);
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("admin@store.os")).toBeNull();
  });

  it("no consulta usuarios cuando no es super_admin", async () => {
    render(<PlatformUsersScreen userRole="member" />);
    expect(screen.getByText("No tienes permiso")).toBeTruthy();
    await waitFor(() => expect(mocks.getDocs).not.toHaveBeenCalled());
  });

  it("permite reintentar si falla la lectura", async () => {
    mocks.getDocs.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ docs: [] });
    render(<PlatformUsersScreen userRole="super_admin" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("No hay usuarios")).toBeTruthy();
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
  });
});

describe("formatPlatformUserDate", () => {
  it("formatea Firestore Timestamp sin convertirlo directamente a Date", () => {
    expect(formatPlatformUserDate({ toDate: () => new Date("2026-01-15T12:00:00Z") })).toMatch(/2026/);
    expect(formatPlatformUserDate(null)).toBe("Sin fecha");
    expect(formatPlatformUserDate({ toDate: () => new Date("invalid") })).toBe("Sin fecha");
  });
});
