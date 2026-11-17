// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderEditorScreen } from "./OrderEditorScreen";
import { resetReturnOriginForTests, setReturnOrigin } from "../../lib/returnOrigin";
import type { Order, Store } from "../../types";

// #463: the pedido's back affordance returns to the area that opened it.
const store = vi.hoisted(() => ({ state: null as unknown as { orders: Order[] }, activeStore: null as unknown as Store, draftOwnerId: "u1" }));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => store, newOrder: () => ({ items: [] }), newCustomer: () => ({}) }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("../../lib/router", async (importOriginal) => ({ ...(await importOriginal<object>()), navigate }));
let sub = "o1";
vi.mock("../../app/router", () => ({ useRoute: () => ({ name: "admin", params: { sub } }) }));

const order: Order = {
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [{ lineId: "l1", productName: "Anillo perla", quantity: 1, unitPrice: 450, subtotal: 450 }],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "unpaid",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const activeStore: Store = {
  id: "s1",
  name: "Joyería",
  type: "inventory",
  ownerId: "u1",
  members: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
} as unknown as Store;

describe("OrderEditorScreen back target (#463)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReturnOriginForTests();
    sub = "o1";
    store.state = { orders: [order], customers: [], products: [], categories: [], expenses: [], stores: [activeStore] } as never;
    store.activeStore = activeStore;
  });

  it("returns to Productos when the pedido was opened from the committed breakdown", () => {
    setReturnOrigin("o1", "/productos");
    render(<ToastProvider><OrderEditorScreen /></ToastProvider>);
    expect(screen.getByRole("button", { name: "← Productos" })).toBeTruthy();
    screen.getByRole("button", { name: "← Productos" }).click();
    expect(navigate).toHaveBeenCalledWith("/productos");
  });

  it("keeps the orders list as the default when no origin was recorded", () => {
    render(<ToastProvider><OrderEditorScreen /></ToastProvider>);
    expect(screen.getByRole("button", { name: "← Pedidos" })).toBeTruthy();
    screen.getByRole("button", { name: "← Pedidos" }).click();
    expect(navigate).toHaveBeenCalledWith("/pedidos");
  });
});
