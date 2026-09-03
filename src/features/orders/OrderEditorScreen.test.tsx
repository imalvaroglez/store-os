// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderEditorScreen } from "./OrderEditorScreen";

const mocks = vi.hoisted(() => ({
  accept: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}));

const activeStore = {
  id: "store_olivia",
  name: "Olivia",
  slug: "olivia",
  type: "inventory_tiered" as const,
};
const request = {
  id: "public_request_1",
  storeId: activeStore.id,
  customerId: "",
  items: [{ productId: "product_1", productName: "Anillo", quantity: 2, unitPrice: 100, subtotal: 200 }],
  deposit: 0,
  orderStatus: "requested" as const,
  paymentStatus: "unpaid" as const,
  source: "public_catalog" as const,
  requesterName: "Ana",
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
};

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      activeStore,
      state: { orders: [request], customers: [], products: [] },
      acceptPublicOrderRequest: mocks.accept,
      deleteOrder: mocks.remove,
    }),
  };
});

vi.mock("../../app/router", () => ({
  useRoute: () => ({ name: "admin", params: { sub: request.id } }),
}));

vi.mock("../../lib/router", () => ({ navigate: mocks.navigate }));

describe("OrderEditorScreen solicitudes públicas", () => {
  beforeEach(() => {
    mocks.accept.mockClear();
    mocks.remove.mockClear();
    mocks.navigate.mockClear();
  });

  it("acepta una solicitud y regresa a pedidos", async () => {
    render(<ToastProvider><OrderEditorScreen /></ToastProvider>);

    expect(screen.getByText("Ana")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar solicitud" }));

    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith(request.id));
    expect(mocks.navigate).toHaveBeenCalledWith("/pedidos");
  });

  it("rechaza una solicitud sólo después de confirmar", async () => {
    render(<ToastProvider><OrderEditorScreen /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Rechazar solicitud" }));
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(request.id));
    expect(mocks.navigate).toHaveBeenCalledWith("/pedidos");
  });
});
