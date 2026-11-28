// @vitest-environment jsdom
// #584: a line with delivered evidence cannot be removed or reduced below
// the delivered count — the badge explains on the line, the save rejects
// with the way out, and the capture + evidence survive (own file: the toast
// singleton carries state across the long OrderForm suite).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderForm } from "./OrderForm";
import { DeliveryEvidenceError } from "../../lib/deliveries";
import type { Order } from "../../types";

const { mockUpsertOrder, activeStore, state } = vi.hoisted(() => ({
  mockUpsertOrder: vi.fn().mockResolvedValue(undefined),
  activeStore: {
    id: "store_olivia",
    name: "Olivia",
    slug: "olivia",
    type: "inventory_tiered" as const,
    priceTiers: [{ id: "t_retail", label: "Iconic", order: 0 }],
    defaultTierId: "t_retail",
  },
  state: {
    products: [],
    categories: [],
    customers: [{ id: "customer_1", storeId: "store_olivia", name: "Cliente Olivia", createdAt: "", updatedAt: "" }],
    purchases: [],
  },
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({ state, activeStore, upsertOrder: mockUpsertOrder, draftOwnerId: "uid_test" }),
  };
});

// Pedido confirmado con entrega parcial: 2 de 5 Anillos entregados (el
// escenario exacto del reporte — evidencia que no puede quedar huérfana).
const order: Order = {
  id: "entrega-parcial",
  storeId: "store_olivia",
  customerId: "customer_1",
  items: [
    { lineId: "l1", productId: "p1", productName: "Anillo", quantity: 5, unitPrice: 100, subtotal: 500 },
    { lineId: "l2", productId: "p2", variantId: "v_cafe", variantColor: "Café", productName: "Guante", quantity: 1, unitPrice: 80, subtotal: 80 },
  ],
  deliveries: [
    {
      id: "dev1",
      orderId: "entrega-parcial",
      storeId: "store_olivia",
      deliveredAt: "2026-11-26",
      recordedAt: "2026-11-26T20:00:00.000Z",
      by: "fer",
      lines: [{ productId: "p1", quantity: 2 }],
    },
  ],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "unpaid",
  schemaVersion: 2,
  createdAt: "2026-11-20",
  updatedAt: "2026-11-26",
} as unknown as Order;

function mount() {
  return render(
    <ToastProvider>
      <OrderForm order={order} onDone={() => {}} />
    </ToastProvider>
  );
}

describe("#584 — la línea con entrega registrada queda protegida en el editor", () => {
  it("muestra la insignia «Entregadas 2» con la explicación y la vía de salida", () => {
    localStorage.clear();
    const rendered = mount();
    const badge = screen.getByText("Entregadas 2");
    expect(badge).toBeInTheDocument();
    expect(screen.queryByText("Entregadas 1")).toBeNull(); // la línea de Guante no
    const title = badge.closest("span[title]")?.getAttribute("title") ?? "";
    expect(title).toContain("No se puede quitar ni bajar la cantidad");
    expect(title).toContain("incidencia del pedido");
    rendered.unmount();
  });

  it("quitar la línea entregada: el guardado se rechaza, la captura sobrevive y nada se escribe", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockResolvedValue(undefined);
    const rendered = mount();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar artículo 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/2 piezas entregadas.*incidencia del pedido/)).toBeInTheDocument());
    expect(mockUpsertOrder).not.toHaveBeenCalled();
    // La captura NO se pierde: la otra línea sigue en el editor.
    expect(screen.getByDisplayValue("Guante")).toBeInTheDocument();
    rendered.unmount();
  });

  it("reducir la cantidad por debajo de lo entregado se rechaza con el mismo mensaje", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockResolvedValue(undefined);
    const rendered = mount();
    // La línea de Anillo se identifica por su cantidad (5), no por índice de render.
    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/no se puede quitar la línea ni bajar la cantidad por debajo de lo entregado/)).toBeInTheDocument());
    expect(mockUpsertOrder).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it("subir la cantidad de la línea entregada guarda con normalidad", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockResolvedValue(undefined);
    const rendered = mount();
    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(mockUpsertOrder).toHaveBeenCalledTimes(1));
    rendered.unmount();
  });

  it("el rechazo del servidor (dos sesiones) muestra SU mensaje, no el genérico", async () => {
    localStorage.clear();
    mockUpsertOrder.mockReset().mockRejectedValueOnce(
      new DeliveryEvidenceError("«Anillo» ya tiene 2 piezas entregadas: no se puede quitar la línea ni bajar la cantidad por debajo de lo entregado, porque la entrega quedaría sin respaldo. Si esas piezas no se entregaron, registra la diferencia desde la incidencia del pedido.")
    );
    const rendered = mount();
    fireEvent.click(screen.getByRole("button", { name: "Guardar pedido" }));
    await waitFor(() => expect(screen.getByText(/la entrega quedaría sin respaldo/)).toBeInTheDocument());
    expect(screen.queryByText(/No se pudo guardar el pedido/)).toBeNull();
    rendered.unmount();
  });
});
