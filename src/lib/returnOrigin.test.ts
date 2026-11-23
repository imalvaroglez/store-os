import { afterEach, describe, expect, it } from "vitest";
import { resetReturnOriginForTests, setReturnOrigin, takeReturnOrigin } from "./returnOrigin";

describe("returnOrigin (#463)", () => {
  afterEach(() => resetReturnOriginForTests());

  it("records and consumes the origin once", () => {
    setReturnOrigin("ord-1", "/productos");
    expect(takeReturnOrigin("ord-1")).toBe("/productos");
    // One-shot: the second read (e.g. a re-render) falls back to the default.
    expect(takeReturnOrigin("ord-1")).toBeUndefined();
  });

  it("keeps origins per pedido — opening another pedido does not steal it", () => {
    setReturnOrigin("ord-1", "/productos");
    setReturnOrigin("ord-2", "/clientes");
    expect(takeReturnOrigin("ord-2")).toBe("/clientes");
    expect(takeReturnOrigin("ord-1")).toBe("/productos");
  });

  it("returns undefined for pedidos opened from their own area", () => {
    expect(takeReturnOrigin("ord-unknown")).toBeUndefined();
  });
});
