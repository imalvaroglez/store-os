// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore } from "./StoreProvider";
import type { AppState, Store } from "../types";
import { SyncErrorNoticeView } from "./App";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  user: { uid: "uid-a", email: "a@example.com", role: "super_admin" as "super_admin" | "member" },
  loadCloudState: vi.fn<() => Promise<AppState>>(),
  subscribeCloudState: vi.fn(),
  deleteEntity: vi.fn(),
  unprojectPublicForStore: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("./firebase/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user, authReady: true, enabled: true, error: null, signOut: vi.fn() }),
}));
vi.mock("./firebase/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./firebase/config")>();
  return {
    ...actual,
    isFirebaseConfigured: () => true,
  };
});
vi.mock("./firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./firebase/firestoreData")>();
  return {
    ...actual,
    loadCloudState: mocks.loadCloudState,
    subscribeCloudState: mocks.subscribeCloudState,
    deleteEntity: mocks.deleteEntity,
    unprojectPublicForStore: mocks.unprojectPublicForStore,
  };
});
vi.mock("../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage")>();
  return {
    ...actual,
    loadPreferredStoreId: () => null,
    savePreferredStoreId: vi.fn(),
  };
});

const store: Store = {
  id: "store-a",
  name: "Tienda A",
  slug: "tienda-a",
  type: "inventory_tiered",
  ownerUid: "uid-a",
  memberUids: ["uid-a"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const testState: AppState = {
  stores: [store],
  activeStoreId: store.id,
  products: [],
  categories: [],
  suppliers: [],
  purchases: [],
  customers: [],
  orders: [],
  expenses: [],
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}

async function waitForCloudHydration() {
  await waitFor(() => expect(mocks.loadCloudState).toHaveBeenCalled());
}

describe("StoreProvider background save errors", () => {
  beforeEach(() => {
    mocks.user = { uid: "uid-a", email: "a@example.com", role: "super_admin" };
    mocks.loadCloudState.mockResolvedValue(testState);
    mocks.subscribeCloudState.mockReturnValue(() => {});
    mocks.deleteEntity.mockReset().mockResolvedValue(undefined);
    mocks.unprojectPublicForStore.mockReset().mockResolvedValue(undefined);
    mocks.loadCloudState.mockClear();
  });

  afterEach(() => cleanup());

  it("shows a rejected background write and clears it after a successful retry", async () => {
    mocks.deleteEntity.mockRejectedValueOnce(new Error("permission-denied"));
    const { result } = renderHook(() => useStore(), { wrapper: Wrapper });
    await waitForCloudHydration();

    act(() => result.current.deleteStore(store.id));
    await waitFor(() => expect(result.current.syncError?.label).toBe("eliminar la tienda"));

    const notice = render(
      <SyncErrorNoticeView
        syncError={result.current.syncError}
        onDismiss={result.current.dismissSyncError}
      />
    );
    expect(screen.getByRole("alert").textContent).toContain("No se pudo eliminar la tienda.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(mocks.deleteEntity).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.syncError).toBeNull());
    notice.unmount();
  });

  it("ignores a failed write from a previous UID and prevents its retry under the new UID", async () => {
    let rejectOldWrite!: (error: Error) => void;
    mocks.deleteEntity.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectOldWrite = reject;
    }));
    const { result, rerender } = renderHook(() => useStore(), { wrapper: Wrapper });
    await waitForCloudHydration();

    act(() => result.current.deleteStore(store.id));
    await waitFor(() => expect(mocks.deleteEntity).toHaveBeenCalledTimes(1));
    mocks.user = { uid: "uid-b", email: "b@example.com", role: "member" };
    rerender();
    await waitFor(() => expect(mocks.loadCloudState).toHaveBeenCalledTimes(2));
    await act(async () => rejectOldWrite(new Error("permission-denied")));
    await waitFor(() => expect(result.current.syncError).toBeNull());
    expect(mocks.deleteEntity).toHaveBeenCalledTimes(1);
  });

  it("does not let a retry from the old UID write after the account changes", async () => {
    mocks.deleteEntity.mockRejectedValueOnce(new Error("permission-denied"));
    const { result, rerender } = renderHook(() => useStore(), { wrapper: Wrapper });
    await waitForCloudHydration();

    act(() => result.current.deleteStore(store.id));
    await waitFor(() => expect(result.current.syncError).not.toBeNull());
    const staleRetry = result.current.syncError!.retry;

    mocks.user = { uid: "uid-b", email: "b@example.com", role: "member" };
    rerender();
    await waitFor(() => expect(result.current.syncError).toBeNull());
    await act(async () => staleRetry());

    expect(mocks.deleteEntity).toHaveBeenCalledTimes(1);
  });
});

describe("StoreProvider cloud hydration races", () => {
  beforeEach(() => {
    mocks.user = { uid: "uid-a", email: "a@example.com", role: "super_admin" };
    mocks.loadCloudState.mockReset().mockResolvedValue(testState);
    mocks.subscribeCloudState.mockReturnValue(() => {});
    mocks.deleteEntity.mockReset().mockResolvedValue(undefined);
    mocks.unprojectPublicForStore.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("ignores a stale cloud hydration from the previous account", async () => {
    let resolveOldLoad!: (state: AppState) => void;
    const staleState: AppState = {
      ...testState,
      stores: [{ ...store, id: "stale", name: "Tienda ajena" }],
      activeStoreId: "stale",
    };
    const freshState: AppState = {
      ...testState,
      stores: [{ ...store, id: "fresh", name: "Tienda B" }],
      activeStoreId: "fresh",
    };
    mocks.loadCloudState
      .mockImplementationOnce(() => new Promise<AppState>((resolve) => { resolveOldLoad = resolve; }))
      .mockResolvedValueOnce(freshState);
    const { result, rerender } = renderHook(() => useStore(), { wrapper: Wrapper });
    await waitFor(() => expect(mocks.loadCloudState).toHaveBeenCalledTimes(1));

    mocks.user = { uid: "uid-b", email: "b@example.com", role: "member" };
    rerender();
    // The new account hydrates normally.
    await waitFor(() => expect(result.current.state.stores.some((s) => s.id === "fresh")).toBe(true));

    // The previous account's read lands late: it must never reach the provider.
    await act(async () => resolveOldLoad(staleState));
    expect(result.current.state.stores.some((s) => s.id === "stale")).toBe(false);
    expect(result.current.state.stores.some((s) => s.id === "fresh")).toBe(true);
  });

  it("ignores a stale load failure from the previous account", async () => {
    let rejectOldLoad!: (error: Error) => void;
    mocks.loadCloudState
      .mockImplementationOnce(() => new Promise<AppState>((_resolve, reject) => { rejectOldLoad = reject; }))
      .mockResolvedValueOnce(testState);
    const { result, rerender } = renderHook(() => useStore(), { wrapper: Wrapper });
    await waitFor(() => expect(mocks.loadCloudState).toHaveBeenCalledTimes(1));

    mocks.user = { uid: "uid-b", email: "b@example.com", role: "member" };
    rerender();
    await waitFor(() => expect(mocks.loadCloudState).toHaveBeenCalledTimes(2));

    // A failure of the old account's read must not raise an error screen (the
    // load-failure channel in the cloud-only world) nor a sync notice under
    // the new session.
    await act(async () => rejectOldLoad(new Error("permission-denied")));
    expect(result.current.stateError).toBeNull();
    expect(result.current.stateStatus).not.toBe("error");
    expect(result.current.syncError).toBeNull();
  });
});
