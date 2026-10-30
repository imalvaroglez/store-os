import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreProvider } from "../../app/StoreProvider";
import { StorePickerScreen } from "./StorePickerScreen";
import { fixtureState } from "../../lib/testFixtures";
import type { AppUser } from "../../app/firebase/auth";
import { saveState } from "../../lib/storage";

// StorePickerScreen reads the session via useAuth(); the real AuthProvider only
// ever reports a user when Firebase is configured, so the tests mock the module
// to place an owner / member / super_admin in the picker.
let mockUser: AppUser | null = null;
let mockAuthEnabled = false;
vi.mock("../../app/firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: mockUser,
    authReady: true,
    enabled: mockAuthEnabled,
    signOut: async () => {},
  }),
}));

const OLIVIA = "store_olivia";

function renderPicker(user: AppUser | null, ownerUid?: string, authEnabled = !!user) {
  const state = fixtureState();
  if (ownerUid) {
    const olivia = state.stores.find((s) => s.id === OLIVIA)!;
    olivia.ownerUid = ownerUid;
  }
  mockUser = user;
  mockAuthEnabled = authEnabled;
  saveState(state);
  return render(
    <StoreProvider>
      <StorePickerScreen />
    </StoreProvider>
  );
}

const ownerOfOlivia: AppUser = { uid: "uid_fer", email: "fer@olivia.mx", role: "member" };
const plainMember: AppUser = { uid: "uid_mar", email: "mar@olivia.mx", role: "member" };
const superAdmin: AppUser = { uid: "uid_root", email: "admin@store.os", role: "super_admin" };

beforeEach(() => {
  localStorage.clear();
  mockUser = null;
  mockAuthEnabled = false;
});

describe("StorePickerScreen gear de Administrar", () => {
  it("la dueña de la tienda ve el ⚙ aunque su rol sea member", () => {
    renderPicker(ownerOfOlivia, "uid_fer");
    expect(screen.getByLabelText("Administrar Olivia")).toBeTruthy();
  });

  it("un member que no es dueña no ve el ⚙", () => {
    renderPicker(plainMember, "uid_fer");
    expect(screen.queryByLabelText("Administrar Olivia")).toBeNull();
  });

  it("super_admin sigue viendo el ⚙ en todas las tiendas (regresión)", () => {
    renderPicker(superAdmin, "uid_fer");
    expect(screen.getByLabelText("Administrar Olivia")).toBeTruthy();
    expect(screen.getByLabelText("Administrar Santi")).toBeTruthy();
  });

  it("en modo local permite administrar tiendas sin sesión", () => {
    renderPicker(null, "uid_fer");
    expect(screen.getByLabelText("Administrar Olivia")).toBeTruthy();
    expect(screen.getByLabelText("Administrar Santi")).toBeTruthy();
    expect(screen.getByLabelText("Administrar Joyería")).toBeTruthy();
  });

  it("con Firebase activo y sin sesión no permite administrar tiendas", () => {
    renderPicker(null, "uid_fer", true);
    expect(screen.queryByLabelText("Administrar Olivia")).toBeNull();
    expect(screen.queryByLabelText("Administrar Santi")).toBeNull();
    expect(screen.queryByLabelText("Administrar Joyería")).toBeNull();
  });
});
