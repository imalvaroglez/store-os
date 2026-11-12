// @vitest-environment jsdom
// #176: email-only invitations and uid-based ownership transfer — the small
// contract tests the independent review asked for. Membership identities are
// private: inviteMember must never resolve uids, and transferStoreOwnership
// must only accept uids already in memberUids.
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Store } from "../types";
import type { AppUser } from "./firebase/auth";

const hooks = vi.hoisted(() => ({
  user: null as AppUser | null,
  load: vi.fn(), subscribe: vi.fn(), save: vi.fn(), invite: vi.fn(),
  snapshot: null as ((state: AppState) => void) | null,
}));
vi.mock("./firebase/AuthProvider", () => ({ useAuth: () => ({ user: hooks.user }) }));
vi.mock("./firebase/config", () => ({ isFirebaseConfigured: () => true, FIREBASE_EMULATOR_ENABLED: false }));
vi.mock("../lib/storage", () => ({
  loadState: () => ({ stores: [], activeStoreId: null, products: [], categories: [], suppliers: [], purchases: [], customers: [], orders: [] }),
  loadPreferredStoreId: () => null, savePreferredStoreId: vi.fn(), saveState: vi.fn(),
}));
vi.mock("./firebase/firestoreData", async (importOriginal) => ({
  ...await importOriginal<typeof import("./firebase/firestoreData")>(),
  loadCloudState: hooks.load,
  subscribeCloudState: hooks.subscribe,
  saveEntity: hooks.save,
  projectPublicForStore: vi.fn().mockResolvedValue(undefined),
  unprojectPublicForStore: vi.fn().mockResolvedValue(undefined),
}));
// normalizeEmail stays REAL (the canonical form matters); only the email send
// is stubbed so the test never touches Firebase Auth.
vi.mock("./firebase/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("./firebase/auth")>(),
  sendInviteLink: hooks.invite,
}));
import { StoreProvider, useStore } from "./StoreProvider";

const store = (extra: Partial<Store> = {}): Store => ({
  id: "s1", name: "Tienda", slug: "tienda", type: "on_demand",
  ownerUid: "owner-1", memberUids: ["owner-1", "member-9"],
  createdAt: "", updatedAt: "", ...extra,
});
const stateWith = (s: Store): AppState => ({
  stores: [s], activeStoreId: "s1", products: [], categories: [], suppliers: [],
  purchases: [], customers: [], orders: [], expenses: [],
});

let context: ReturnType<typeof useStore>;
function Probe() {
  context = useStore();
  return <span data-testid="stores">{context.state.stores.length}</span>;
}
async function mount() {
  const view = render(<StoreProvider><Probe /></StoreProvider>);
  // #382: wait for the loaded state to be APPLIED, not merely for load() to
  // have been called — under parallel load the dispatch can lag the call by a
  // microtask, leaving state.stores empty and the membership tests racing
  // against "Tienda no encontrada.".
  await waitFor(() => expect(screen.getByTestId("stores").textContent).toBe("1"));
  return view;
}

beforeEach(() => {
  hooks.snapshot = null;
  hooks.user = { uid: "owner-1", role: "member", email: "owner@example.test" } as AppUser;
  hooks.load.mockReset().mockResolvedValue(stateWith(store()));
  hooks.subscribe.mockReset().mockImplementation((...args) => { hooks.snapshot = args[args.length - 1]; });
  hooks.save.mockReset().mockResolvedValue(undefined);
  hooks.invite.mockReset().mockResolvedValue(undefined);
});

describe("inviteMember is email-only (#176)", () => {
  it("always returns pending, stores the CANONICAL email and never touches memberUids", async () => {
    await mount();
    let result: "pending" | undefined;
    await act(async () => {
      result = await context.inviteMember("s1", "Fer.Jewerly@GoogleMail.com");
    });
    expect(result).toBe("pending");
    expect(hooks.invite).toHaveBeenCalledWith("fer.jewerly@googlemail.com", expect.anything());
    // Background saves (profile/theme) also hit saveEntity: assert on the
    // store-collection write, not on call order.
    const storeSaves = hooks.save.mock.calls.filter((c) => c[1] === "stores");
    expect(storeSaves.length).toBeGreaterThan(0);
    const saved = storeSaves[storeSaves.length - 1][2] as Store;
    expect(saved.pendingInvites).toEqual(["ferjewerly@gmail.com"]);
    expect(saved.memberUids).toEqual(["owner-1", "member-9"]);
  });
});

describe("transferStoreOwnership is uid-based (#176)", () => {
  it("rejects a uid that is not a member", async () => {
    await mount();
    await act(async () => {
      await expect(context.transferStoreOwnership("s1", "intruso-1")).rejects.toThrow(
        /debe ser miembro/
      );
    });
    // Mount itself re-persists the loaded store unchanged (preexisting
    // normalization write-back); what must NOT happen is an ownership change.
    const storeCalls = hooks.save.mock.calls.filter((c) => c[1] === "stores");
    expect(storeCalls.every((c) => (c[2] as Store).ownerUid === "owner-1")).toBe(true);
  });

  it("transfers to an existing member and is a no-op for the current owner", async () => {
    await mount();
    await act(async () => {
      await context.transferStoreOwnership("s1", "member-9");
    });
    const storeSaves = hooks.save.mock.calls.filter((c) => c[1] === "stores");
    expect(storeSaves.length).toBeGreaterThan(0);
    const saved = storeSaves[storeSaves.length - 1][2] as Store;
    expect(saved.ownerUid).toBe("member-9");
    const savesBefore = hooks.save.mock.calls.length;
    await act(async () => {
      await context.transferStoreOwnership("s1", "member-9");
    });
    expect(hooks.save.mock.calls.length).toBe(savesBefore);
  });
});
