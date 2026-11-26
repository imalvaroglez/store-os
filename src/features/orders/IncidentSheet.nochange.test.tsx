// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { IncidentSheet } from "./IncidentSheet";
import type { Order, OrderIncident } from "../../types";

// #560: the clienta backed out before anything happened — the operator closes
// the incident «Sin cambio» with a mandatory motive. The sheet keeps the
// history visible and never offers the close on an incident with executed
// facts (those stay protected).

const mocks = vi.hoisted(() => ({
  state: { products: [] },
  activeStore: { id: "s1" },
  openIncident: vi.fn(),
  applyIncidentEvent: vi.fn(),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => mocks }));

const NOW = "2026-11-20T10:00:00.000Z";

const incident = (events: OrderIncident["events"], extra: Partial<OrderIncident> = {}): OrderIncident => ({
  id: "inc-1",
  lineId: "l30",
  productId: "p30",
  productName: "Aro cambio",
  quantity: 1,
  reason: "Piedra fallada",
  originalUnitPriceCents: 3000,
  events,
  ...extra,
});

const orderWith = (inc: OrderIncident): Order => ({
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [
    { lineId: "l1", productId: "p1", productName: "Collar", quantity: 1, unitPrice: 760, subtotal: 760 },
    { lineId: "l30", productId: "p30", productName: "Aro cambio", quantity: 1, unitPrice: 30, subtotal: 30 },
  ],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "partial",
  paymentsReceivedCents: 82000,
  createdAt: NOW,
  updatedAt: NOW,
  incidents: [inc],
});

function renderSheet(order: Order) {
  return render(
    <ToastProvider>
      <IncidentSheet order={order} open onClose={() => {}} />
    </ToastProvider>
  );
}

describe("IncidentSheet cierre sin cambio (#560)", () => {
  beforeEach(() => {
    mocks.openIncident.mockReset();
    mocks.applyIncidentEvent.mockReset().mockResolvedValue(undefined);
  });

  it("cierra sin cambio con motivo obligatorio y deja el hecho firmado", async () => {
    // Resolución acordada (la pieza del cambio quedó cargada), sin ejecutar.
    const agreed = incident(
      [
        { id: "e1", at: NOW, by: "u1", kind: "opened" },
        { id: "e2", at: NOW, by: "u1", kind: "resolution_agreed" },
      ],
      {
        resolution: { kind: "replacement_with_difference", saleAdjustmentUnitCents: 3000 },
        replacement: { productId: "p2", productName: "Aro", unitPriceCents: 6000, unitCostCents: 2000, chargeDifference: true },
      },
    );
    renderSheet(orderWith(agreed));

    fireEvent.click(screen.getAllByRole("button", { name: /Cerrar sin cambio/i })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Cerrar sin cambio" });
    const confirm = within(dialog).getByRole("button", { name: /^Cerrar sin cambio$/ });
    // Sin motivo no se puede confirmar.
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/i), { target: { value: "La clienta ya no quiere el cambio" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.applyIncidentEvent).toHaveBeenCalledTimes(1));
    const [, , event] = mocks.applyIncidentEvent.mock.calls[0];
    expect(event.kind).toBe("closed_no_change");
    expect(event.detail).toEqual({ reason: "La clienta ya no quiere el cambio" });
  });

  it("una incidencia cerrada muestra el hecho y ya no ofrece resolución ni confirmación", () => {
    const closed = incident([
      { id: "e1", at: NOW, by: "u1", kind: "opened" },
      { id: "e2", at: NOW, by: "u1", kind: "closed_no_change", detail: { reason: "La clienta ya no quiere el cambio" } },
    ]);
    renderSheet(orderWith(closed));

    expect(screen.getByText(/Cerrada sin cambio/i)).toBeTruthy();
    expect(screen.getByText(/La clienta ya no quiere el cambio/i)).toBeTruthy();
    expect(screen.getByText(/retirarla o corregirla desde el editor del pedido/i)).toBeTruthy();
    // Cerrada: no hay formulario de resolución ni acciones de entrega.
    expect(screen.queryByRole("button", { name: /Acordar resolución/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirmar recepción/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cerrar sin cambio/i })).toBeNull();
  });

  it("una incidencia con hechos ejecutados no ofrece el cierre (protección #368 intacta)", () => {
    const executed = incident(
      [
        { id: "e1", at: NOW, by: "u1", kind: "opened" },
        { id: "e2", at: NOW, by: "u1", kind: "resolution_agreed" },
        { id: "e3", at: NOW, by: "u1", kind: "confirmed" },
      ],
      { resolution: { kind: "replacement_equivalent" }, replacement: { productId: "p2", productName: "Aro", unitPriceCents: 3000, unitCostCents: 2000, chargeDifference: false } },
    );
    renderSheet(orderWith(executed));
    expect(screen.queryByRole("button", { name: /Cerrar sin cambio/i })).toBeNull();
    // La solución ejecutada sigue con sus acciones posteriores.
    expect(screen.getByRole("button", { name: /Reparado/i })).toBeTruthy();
  });
});
