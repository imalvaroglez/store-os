import { describe, expect, it } from "vitest";
import { publicAvailabilitySignal, publicAvailabilityValue } from "./publicAvailability";

describe("inventory authority (#489)", () => {
  it.each([['disponible', 'available'], ['pocas', 'low_stock'], ['agotado', 'sold_out']] as const)("uses %s even when a legacy manual mark disagrees", (stockSignal, availability) => {
    const product = { stockSignal, availability: stockSignal === 'agotado' ? 'available' : 'sold_out' };
    expect(publicAvailabilitySignal(product, 'inventory_tiered')).toBe(stockSignal);
    expect(publicAvailabilityValue(product, 'inventory_tiered')).toBe(availability);
  });
  it("keeps on-demand manual availability and conservative legacy fallback without a stock signal", () => {
    expect(publicAvailabilitySignal({ availability: 'sold_out', stockSignal: 'disponible' }, 'on_demand')).toBe('agotado');
    expect(publicAvailabilityValue({ availability: 'sold_out', stockSignal: 'disponible' }, 'on_demand')).toBe('sold_out');
    expect(publicAvailabilitySignal({ availability: 'sold_out' }, 'inventory_tiered')).toBe('agotado');
  });
});
