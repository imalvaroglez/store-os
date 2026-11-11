// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("./navItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./navItems")>();
  return { ...actual, navigate: mocks.navigate };
});

// #325: the mobile nav's ▾ toggle — behavior and the right-anchored 44×44 hit
// area (a centered box overlapped the neighboring tab at 390px; right-anchored
// it stays inside its own tab).
describe("BottomNav ▾ (#325)", () => {
  it("alterna el panel hacia arriba sin navegar", () => {
    render(<BottomNav active="pedidos" storeType="inventory_tiered" />);
    const chevron = screen.getByRole("button", { name: "Expandir" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
  });

  it("el área de toque de 40px queda anclada al borde derecho de SU pestaña (sin invadir vecinos)", () => {
    render(<BottomNav active="pedidos" storeType="inventory_tiered" />);
    const chevron = screen.getByRole("button", { name: "Expandir" });
    expect(chevron.className).toContain("after:right-0");
    expect(chevron.className).toContain("after:h-11");
    expect(chevron.className).toContain("after:w-10");
  });
});
