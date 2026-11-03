import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StorePickerScreen } from "./StorePickerScreen";
import { fixtureState } from "../../lib/testFixtures";
import type { AppUser } from "../../app/firebase/auth";
import type { AppState } from "../../types";

const mocks = vi.hoisted(() => ({
  user: null as AppUser | null,
  state: null as AppState | null,
  setActiveStore: vi.fn(),
}));

vi.mock("../../app/firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: mocks.user,
    authReady: true,
    enabled: false,
    error: null,
    signOut: async () => {},
  }),
}));
vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({ state: mocks.state, setActiveStore: mocks.setActiveStore }),
  };
});

const OLIVIA = "store_olivia";

function renderPicker(user: AppUser | null, ownerUid?: string) {
  const state = fixtureState();
  if (ownerUid) {
    const olivia = state.stores.find((s) => s.id === OLIVIA)!;
    olivia.ownerUid = ownerUid;
  }
  mocks.user = user;
  mocks.state = state;
  return render(<StorePickerScreen />);
}

const ownerOfOlivia: AppUser = { uid: "uid_fer", email: "fer@olivia.mx", role: "member" };
const plainMember: AppUser = { uid: "uid_mar", email: "mar@olivia.mx", role: "member" };
const superAdmin: AppUser = { uid: "uid_root", email: "admin@store.os", role: "super_admin" };

beforeEach(() => {
  localStorage.clear();
  mocks.user = null;
  mocks.state = null;
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
