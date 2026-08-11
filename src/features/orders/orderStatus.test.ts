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
    expect(ORDER_STATUS_LABELS.bought).toBe("Comprado");
    expect(ORDER_STATUS_LABELS.delivered).toBe("Entregado");
    expect(ORDER_STATUS_LABELS.paid).toBe("Cobrado");
  });

  it("nextActionVerb returns imperatives (the action), not participles", () => {
    // asked -> confirmed: "Confirmar"
    expect(nextActionVerb("asked")).toBe("Confirmar");
    // confirmed -> to_buy: "Comprar"
    expect(nextActionVerb("confirmed")).toBe("Comprar");
    // to_buy -> bought: "Marcar comprado"
    expect(nextActionVerb("to_buy")).toBe("Marcar comprado");
    // bought -> arrived: "Marcar llegada"
    expect(nextActionVerb("bought")).toBe("Marcar llegada");
    // arrived -> delivered: "Entregar"
    expect(nextActionVerb("arrived")).toBe("Entregar");
    // delivered -> paid: "Cobrar"
    expect(nextActionVerb("delivered")).toBe("Cobrar");
  });

  it("nextActionVerb returns null at the terminal status (paid)", () => {
    expect(nextActionVerb("paid")).toBeNull();
  });

  it("nextStatus still flows linearly", () => {
    expect(nextStatus("asked")).toBe("confirmed");
    expect(nextStatus("paid")).toBeNull();
  });
});
