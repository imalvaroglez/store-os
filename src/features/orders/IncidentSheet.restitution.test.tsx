// @vitest-environment jsdom
// #380 QA r2 (MAYOR que persiste): the confirm's post-commit credit
// restitution must be AUDIBLE at the confirmation point and RETRYABLE with a
// stable identity. These tests pin the operator contract: fallo → aviso →
// reintento con el MISMO evento → saldo restituido una sola vez.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { IncidentSheet } from "./IncidentSheet";
import { pendingRestitutionCents } from "./incidentMoney";
import type { Order, OrderIncident, Product } from "../../types";

const mocks = vi.hoisted(() => ({
  state: { products: [] as Product[] },
  activeStore: { id: "s1" },
  openIncident: vi.fn(),
  applyIncidentEvent: vi.fn(),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => mocks }));

const NOW = "2026-11-17T10:00:00.000Z";

// Order B: 800 pesos, 500 paid + 300 credit applied from sister order A.
// Refund incident on the 300-peso piece, destination credit_accepted: the
// whole 300 is credit restitution (no cash).
function baseOrder(extraLedger: Order["creditLedger"], confirmed: boolean): Order {
  const events: OrderIncident["events"] = [
    { id: "iev-1", at: NOW, by: "u1", kind: "opened" },
    { id: "iev-2", at: NOW, by: "u1", kind: "resolution_agreed" },
    ...(confirmed ? [{ id: "iev-c9", at: NOW, by: "u1", kind: "confirmed" } as const] : []),
  ];
  return {
    id: "oB",
    storeId: "s1",
    customerId: "c1",
    items: [{ lineId: "l1", productId: "p1", productName: "Collar", quantity: 1, unitPrice: 800, subtotal: 800 }],
    deposit: 0,
    orderStatus: "delivered",
    paymentStatus: "paid",
    paymentsReceivedCents: 50000,
    creditAppliedCents: 30000,
    createdAt: NOW,
    updatedAt: NOW,
    creditLedger: [{ id: "app-1", kind: "application", fromOrderId: "oA", amountCents: 30000, at: NOW, by: "u1" }, ...(extraLedger ?? [])],
    incidents: [{
      id: "inc-1",
      productId: "p1",
      productName: "Collar",
      quantity: 1,
      reason: "Piedra fallada",
      originalUnitPriceCents: 30000,
      resolution: { kind: "refund", destination: "credit_accepted", saleAdjustmentUnitCents: 30000, refundOwedCents: 0 },
      events,
    } as OrderIncident],
  } as Order;
}

function renderSheet(order: Order) {
  mocks.state.products = [];
  return render(
    <ToastProvider>
      <IncidentSheet order={order} open onClose={() => {}} />
    </ToastProvider>
  );
}

async function confirmReception(order: Order, rejectsFirstWith?: Error) {
  mocks.applyIncidentEvent.mockReset();
  if (rejectsFirstWith) {
    mocks.applyIncidentEvent
      .mockRejectedValueOnce(rejectsFirstWith)
      .mockResolvedValueOnce(undefined);
  } else {
    mocks.applyIncidentEvent.mockResolvedValue(undefined);
  }
  renderSheet(order);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción de la pieza + entrega" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
  await waitFor(() => expect(mocks.applyIncidentEvent).toHaveBeenCalled());
}

beforeEach(() => {
  mocks.applyIncidentEvent.mockReset();
});

describe("confirmación con restitución que falla", () => {
  it("muestra el fallo en el momento y reintenta con el MISMO id de evento", async () => {
    await confirmReception(
      baseOrder(undefined, false),
      new Error("La incidencia quedó confirmada, pero solo se restituyeron 0 de los 300 pesos de saldo a favor que debían volver a la clienta.")
    );

    // The failure is audible at the confirmation point — same message the
    // data layer threw, no generic mask.
    await waitFor(() =>
      expect(screen.getByText(/solo se restituyeron 0 de los 300 pesos/)).toBeTruthy()
    );

    // Retry: a fresh confirmation attempt must reuse the SAME event id (the
    // self-heal key), not mint a new one that dies on the guard.
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción de la pieza + entrega" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.applyIncidentEvent).toHaveBeenCalledTimes(2));
    const first = mocks.applyIncidentEvent.mock.calls[0][2] as { id: string };
    const second = mocks.applyIncidentEvent.mock.calls[1][2] as { id: string };
    expect(second.id).toBe(first.id);
  });
});

describe("restitución pendiente tras confirmar", () => {
  it("ofrece un reintento visible que reprocesa el evento confirmado almacenado", async () => {
    mocks.applyIncidentEvent.mockResolvedValue(undefined);
    const order = baseOrder(undefined, true); // confirmed, nothing released
    renderSheet(order);

    await waitFor(() => {
      expect(screen.getByText(/por devolver al saldo a favor de la clienta/)).toBeTruthy();
      expect(screen.getAllByText((_, element) => element?.tagName === "SPAN" && element.textContent === "$300.00").length).toBeGreaterThan(0);
    });
    const retry = screen.getByRole("button", { name: "Reintentar restitución" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.applyIncidentEvent).toHaveBeenCalledTimes(1));
    const [, incidentId, event] = mocks.applyIncidentEvent.mock.calls[0];
    expect(incidentId).toBe("inc-1");
    // The retry replays the STORED confirm event — same identity, idempotent.
    expect(event).toMatchObject({ id: "iev-c9", kind: "confirmed" });
  });

  it("no muestra pendiente cuando la restitución ya se completó", async () => {
    const order = baseOrder(
      [{ id: "rel_iev-c9_1", kind: "release", fromOrderId: "oA", amountCents: 30000, at: NOW, by: "u1" }],
      true
    );
    renderSheet(order);

    await waitFor(() => expect(screen.getByText(/Piedra fallada/)).toBeTruthy());
    expect(screen.queryByText(/por devolver al saldo a favor/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar restitución" })).toBeNull();
  });
});

describe("pendingRestitutionCents (motor compartido con la capa de datos)", () => {
  const incidentOf = (o: Order) => o.incidents![0];

  it("cuenta lo no liberado de la obligación de la incidencia confirmada", () => {
    const order = baseOrder(undefined, true);
    expect(pendingRestitutionCents(order, incidentOf(order))).toBe(30000);
  });

  it("descuenta lo ya liberado con la etiqueta del evento", () => {
    const partial = baseOrder(
      [{ id: "rel_iev-c9_1", kind: "release", fromOrderId: "oA", amountCents: 12000, at: NOW, by: "u1" }],
      true
    );
    expect(pendingRestitutionCents(partial, incidentOf(partial))).toBe(18000);
  });

  it("usa la obligación CONGELADA aunque el crédito aplicado ya bajó (QA r3 MAYOR-1)", () => {
    // Post-partial-release: the callable already decremented creditApplied
    // (30000→12000) and a partial 12000 release is tagged. Pending is the
    // FROZEN 20000 − 12000 landed = 8000 — a recomputed min(12000, …) would
    // hide the clienta's missing money.
    const incident = { ...baseOrder(undefined, true).incidents![0] };
    incident.events = [
      ...incident.events!.filter((e) => e.kind !== "confirmed"),
      { id: "iev-c9", at: NOW, by: "u1", kind: "confirmed", detail: { restitutionCents: 20000 } },
    ];
    const order = {
      ...baseOrder([{ id: "rel_iev-c9_1", kind: "release", fromOrderId: "oA", amountCents: 12000, at: NOW, by: "u1" }], false),
      creditAppliedCents: 12000,
      incidents: [incident],
    } as Order;
    expect(pendingRestitutionCents(order, incident)).toBe(8000);
  });

  it("es cero sin confirmación o sin obligación de crédito", () => {
    const unconfirmed = baseOrder(undefined, false);
    expect(pendingRestitutionCents(unconfirmed, incidentOf(unconfirmed))).toBe(0);
    const noCredit = { ...baseOrder(undefined, true), creditAppliedCents: 0 } as Order;
    expect(pendingRestitutionCents(noCredit, incidentOf(noCredit))).toBe(0);
  });
});
