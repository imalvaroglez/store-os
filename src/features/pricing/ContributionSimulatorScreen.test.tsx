// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { ContributionSimulatorScreen } from "./ContributionSimulatorScreen";
import type { Category, Product } from "../../types";

const mocks = vi.hoisted(() => ({
  state: { products: [] as Product[], categories: [] as Category[] },
  activeStore: {
    id: "s1", name: "Olivia", type: "inventory_tiered",
    priceTiers: [
      { id: "t_retail", label: "Regular", order: 0 },
      { id: "t_girly", label: "Girly", order: 1 },
    ],
  },
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ state: mocks.state, activeStore: mocks.activeStore }) }));
vi.mock("../../lib/router", () => ({ navigate: vi.fn() }));

const NOW = "2026-11-16T10:00:00.000Z";
const design = (id: string, cost: number | undefined, prices: Record<string, number>): Product =>
  ({ id, storeId: "s1", name: id, category: "other", categoryIds: ["c1"], isPublic: true, status: "published",
     ...(cost != null ? { cost } : {}), prices, quantityOnHand: 5, createdAt: NOW, updatedAt: NOW }) as unknown as Product;

beforeEach(() => {
  mocks.state.categories = [{ id: "c1", storeId: "s1", name: "Anillos", slug: "anillos", active: true, sortOrder: 1, createdAt: NOW, updatedAt: NOW } as Category];
  mocks.state.products = [design("anillo", 50, { t_retail: 93, t_girly: 150 })];
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ContributionSimulatorScreen (#336)", () => {
  it("simula una pieza: q* fraccional con referencia, igualar y superar; totales y delta exactos", async () => {
    render(<ToastProvider><ContributionSimulatorScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Pieza"), { target: { value: "anillo" } });
    // Elegir la pieza prellena el precio actual del nivel (93).
    expect((screen.getByLabelText("Precio actual") as HTMLInputElement).value).toBe("93");
    fill("Precio propuesto", "100");
    fill("Volumen base (piezas)", "10");
    // c0 = 43, c1 = 50 → q* = 8.6 → 9 para igualar/superar.
    expect(screen.getByText("8.6")).toBeTruthy();
    expect(screen.getAllByText(/9 piezas igualan o superan/)).toHaveLength(1);
    expect(screen.getByText(/9 para superar/)).toBeTruthy();
    expect(screen.getByText("$500.00")).toBeTruthy(); // total del escenario
    expect(screen.getByText(/\$70\.00/)).toBeTruthy(); // delta vs base
    expect(screen.getByText(/escenario, no un pronóstico/i)).toBeTruthy();
  });

  it("la sensibilidad compara volúmenes indicados, como escenario", () => {
    render(<ToastProvider><ContributionSimulatorScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Pieza"), { target: { value: "anillo" } });
    fill("Precio propuesto", "100");
    fill("Volumen base (piezas)", "10");
    fill("Cambios de volumen a comparar (%)", "-20, 10");
    expect(screen.getByText(/-20%/)).toBeTruthy();
    // El badge de sensibilidad mezcla texto y Money: match por contenido completo.
    const chip = (label: string, money: string) => screen.getAllByText(
      (_, element) => element?.tagName === "LI" && element.textContent === `${label} · ${money}`
    );
    expect(chip("-20% → 8 piezas", "$400.00")).toHaveLength(1);
    expect(chip("+10% → 11 piezas", "$550.00")).toHaveLength(1);
  });

  it("romper la escalera comercial es infactible y nombra la restricción", () => {
    render(<ToastProvider><ContributionSimulatorScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Pieza"), { target: { value: "anillo" } });
    fireEvent.change(screen.getByLabelText("Nivel"), { target: { value: "t_girly" } });
    fill("Precio propuesto", "90"); // por debajo de Regular (93)
    fill("Volumen base (piezas)", "10");
    expect(screen.getByText(/Sin escenario factible/)).toBeTruthy();
    expect(screen.getByText(/debe costar más que Regular/)).toBeTruthy();
    expect(screen.queryByText(/\$4,?000\.00|q\*/)).toBeNull(); // sin cifras de escenario
  });

  it("costo desconocido: no se calcula como si fuera cero", () => {
    mocks.state.products = [design("sinCosto", undefined, { t_retail: 100 })];
    render(<ToastProvider><ContributionSimulatorScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Pieza"), { target: { value: "sinCosto" } });
    fill("Precio propuesto", "120");
    fill("Volumen base (piezas)", "10");
    expect(screen.getByText(/Costo desconocido o incompleto/)).toBeTruthy();
    expect(screen.getByText(/nunca se trata como cero/)).toBeTruthy();
  });

  it("modo categoría: conjunto declarado, volumen y precio como supuesto global", () => {
    render(<ToastProvider><ContributionSimulatorScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Simular"), { target: { value: "categoria" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    fill("Precio actual", "93");
    fill("Precio propuesto", "100");
    fill("Costo variable por pieza (opcional)", "50");
    fill("Volumen base (piezas)", "10");
    expect(screen.getByText(/1 pieza en esta categoría/)).toBeTruthy();
    expect(screen.getByText(/sin canibalización ni aumento de demanda simulados/)).toBeTruthy();
    expect(screen.getByText("8.6")).toBeTruthy();
  });
});
