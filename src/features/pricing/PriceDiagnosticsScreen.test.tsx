// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { PriceDiagnosticsScreen } from "./PriceDiagnosticsScreen";
import type { Category, Product } from "../../types";

const mocks = vi.hoisted(() => ({
  state: {
    products: [] as Product[],
    categories: [] as Category[],
  },
  activeStore: { id: "s1", name: "Olivia", type: "inventory_tiered", priceTiers: [
    { id: "t_retail", label: "Regular", order: 0 },
    { id: "t_girly", label: "Girly", order: 1 },
  ] },
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ state: mocks.state, activeStore: mocks.activeStore }) }));

const NOW = "2026-11-14T10:00:00.000Z";
const design = (id: string, cost: number | undefined, price: number): Product =>
  ({ id, storeId: "s1", name: id, category: "other", categoryIds: ["c1"], isPublic: true, status: "published",
     ...(cost != null ? { cost } : {}), prices: { t_retail: price }, quantityOnHand: 2, createdAt: NOW, updatedAt: NOW }) as unknown as Product;

beforeEach(() => {
  mocks.state.categories = [{ id: "c1", storeId: "s1", name: "Anillos", slug: "anillos", active: true, sortOrder: 1, createdAt: NOW, updatedAt: NOW } as Category];
  mocks.state.products = Array.from({ length: 9 }, (_, i) => design(`p${i}`, 20, 90 + i * 10));
});

describe("PriceDiagnosticsScreen (#335)", () => {
  it("muestra mediana, IQR, muestra y método; sin etiquetas de juicio", () => {
    render(<ToastProvider><PriceDiagnosticsScreen /></ToastProvider>);
    expect(screen.getByText(/9 piezas con precio/)).toBeTruthy();
    expect(screen.getByText(/método mediana · IQR/)).toBeTruthy();
    expect(screen.getByText(/Mediana/)).toBeTruthy();
    expect(screen.getByText(/\$130\.00/)).toBeTruthy();
    expect(screen.getAllByText(/IQR/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/malo|subvaluado|oportunidad/);
  });

  it("evidencia insuficiente con menos de 3 piezas con precio", () => {
    mocks.state.products = [design("solo", 20, 100)];
    render(<ToastProvider><PriceDiagnosticsScreen /></ToastProvider>);
    expect(screen.getByText(/Evidencia insuficiente/)).toBeTruthy();
  });

  it("análisis por periodo NO disponible hasta #333, con nota explícita", () => {
    render(<ToastProvider><PriceDiagnosticsScreen /></ToastProvider>);
    expect(screen.getByText(/#333/)).toBeTruthy();
  });

  it("el nivel se elige y la categoría filtra sin mezclar muestras", () => {
    render(<ToastProvider><PriceDiagnosticsScreen /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c1" } });
    expect(screen.getByText(/9 piezas con precio de 9/)).toBeTruthy();
  });
});
