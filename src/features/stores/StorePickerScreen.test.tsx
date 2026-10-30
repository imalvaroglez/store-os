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
vi.mock("../../app/firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: mockUser,
    authReady: true,
    enabled: false,
    signOut: async () => {},
  }),
}));

const OLIVIA = "store_olivia";

function renderPicker(user: AppUser | null, ownerUid?: string) {
  const state = fixtureState();
  if (ownerUid) {
    const olivia = state.stores.find((s) => s.id === OLIVIA)!;
    olivia.ownerUid = ownerUid;
  }
  mockUser = user;
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

  it("sin sesión no hay ⚙ en ninguna tienda (ni sin ownerUid)", () => {
    renderPicker(null, "uid_fer");
    expect(screen.queryByLabelText("Administrar Olivia")).toBeNull();
    // Santi/Joyería no tienen ownerUid en el fixture: undefined === undefined
    // no debe colarse cuando user es null (review F1).
    expect(screen.queryByLabelText("Administrar Santi")).toBeNull();
    expect(screen.queryByLabelText("Administrar Joyería")).toBeNull();
  });
});
