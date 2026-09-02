import { describe, it, expect } from "vitest";
import {
  ORDER_STATUS_LABELS,
  nextActionVerb,
  nextStatus,
} from "./orderStatus";

// M3: the next-action button verb must be IMPERATIVE (the action to take),
// not the participle of the target state. The status badge (participle) is a
// separate vocabulary and stays unchanged.

describe("orderStatus", () => {
  it("status labels stay participles (the badge shows current state)", () => {
    expect(ORDER_STATUS_LABELS.confirmed).toBe("Confirmado");
    expect(ORDER_STATUS_LABELS.quoted).toBe("Cotizado");
    expect(ORDER_STATUS_LABELS.preparing).toBe("Preparando");
    expect(ORDER_STATUS_LABELS.ready).toBe("Listo");
    expect(ORDER_STATUS_LABELS.delivered).toBe("Entregado");
    expect(ORDER_STATUS_LABELS.cancelled).toBe("Cancelado");
  });

  it("nextActionVerb returns imperatives (the action), not participles", () => {
    expect(nextActionVerb("asked")).toBe("Cotizar");
    expect(nextActionVerb("quoted")).toBe("Confirmar");
    expect(nextActionVerb("confirmed")).toBe("Preparar");
    expect(nextActionVerb("preparing")).toBe("Marcar listo");
    expect(nextActionVerb("ready")).toBe("Entregar");
    expect(nextActionVerb("delivered")).toBeNull();
  });

  it("nextActionVerb returns null at terminal statuses", () => {
    expect(nextActionVerb("cancelled")).toBeNull();
  });

  it("nextStatus still flows linearly", () => {
    expect(nextStatus("asked")).toBe("quoted");
    expect(nextStatus("delivered")).toBeNull();
  });
});
