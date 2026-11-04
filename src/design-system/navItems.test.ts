import { describe, expect, it } from "vitest";
import { visibleNavItems } from "./navItems";

describe("visibleNavItems", () => {
  it("muestra Usuarios solo a super_admin, en cualquier tipo de tienda", () => {
    expect(visibleNavItems("inventory_tiered", "super_admin").some((item) => item.id === "usuarios")).toBe(true);
    expect(visibleNavItems("on_demand", "super_admin").some((item) => item.id === "usuarios")).toBe(true);
    expect(visibleNavItems("inventory_tiered", "member").some((item) => item.id === "usuarios")).toBe(false);
    expect(visibleNavItems("inventory_tiered").some((item) => item.id === "usuarios")).toBe(false);
  });
});
