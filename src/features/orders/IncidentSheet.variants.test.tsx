// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { IncidentSheet } from "./IncidentSheet";
import type { Order, OrderIncident, Product } from "../../types";

// #364: replacing with a design sold per color REQUIRES choosing the color —
// the confirm transaction moves that color's shelf and fails closed without
// it. The sheet must not let Fer agree on a color-less replacement.

const mocks = vi.hoisted(() => ({
  state: { products: [] as Product[] },
  activeStore: { id: "s1" },
  openIncident: vi.fn(),
  applyIncidentEvent: vi.fn(),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => mocks }));

const NOW = "2026-11-12T10:00:00.000Z";

const order: Order = {
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [{ lineId: "l1", productId: "p-classic", productName: "Anillo Clásico", quantity: 1, unitPrice: 120, subtotal: 120 }],
  deposit: 0,
  orderStatus: "delivered",
  paymentStatus: "paid",
  paymentsReceivedCents: 12000,
  createdAt: NOW,
  updatedAt: NOW,
  incidents: [{
    id: "inc-1",
    productId: "p-classic",
    productName: "Anillo Clásico",
    quantity: 1,
    reason: "Piedra fallada",
    originalUnitPriceCents: 12000,
    events: [{ id: "iev-1", at: NOW, by: "u1", kind: "opened" }],
  } as OrderIncident],
};

const variant = (id: string, color: string, quantityOnHand?: number) => ({
  id,
  color,
  ...(quantityOnHand !== undefined ? { quantityOnHand } : {}),
  createdAt: NOW,
  updatedAt: NOW,
});

const products: Product[] = [
  {
    id: "p-classic", storeId: "s1", name: "Anillo Clásico", category: "other",
    isPublic: true, status: "published", quantityOnHand: 3, price: 120, cost: 50,
    createdAt: NOW, updatedAt: NOW,
  } as Product,
  {
    id: "p-luna", storeId: "s1", name: "Diseño Luna", category: "other",
    isPublic: true, status: "published", price: 150, cost: 40,
    variants: [variant("v-red", "Rojo", 2), variant("v-blue", "Azul", 0)],
    createdAt: NOW, updatedAt: NOW,
  } as Product,
];

function renderSheet() {
  mocks.state.products = products;
  return render(
    <ToastProvider>
      <IncidentSheet order={order} open onClose={() => {}} />
    </ToastProvider>
  );
}

async function pickReplacement() {
  const input = screen.getByRole("combobox", { name: "Pieza alternativa" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Diseño Luna" } });
  // The listbox is open while typing: the option detail shows the honest
  // aggregate (2 across colors — NOT the lying design-level 0).
  await waitFor(() => expect(screen.getByText(/Existencia: 2 en 2 colores/i)).toBeTruthy());
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.getByText(/Elige el color que entregas/i)).toBeTruthy());
}

describe("IncidentSheet reemplazo por color (#364)", () => {
  beforeEach(() => {
    mocks.openIncident.mockReset();
    mocks.applyIncidentEvent.mockReset().mockResolvedValue(undefined);
  });

  it("exige el color del reemplazo cuando la pieza se vende por color", async () => {
    renderSheet();
    // Default resolution is replacement_equivalent; pick the variant design.
    await pickReplacement();

    const colorSelect = screen.getByLabelText(/Color del reemplazo/i) as HTMLSelectElement;
    expect(colorSelect.value).toBe("");
    const agree = screen.getByRole("button", { name: /Acordar resolución/i });
    expect(agree).toBeDisabled();

    fireEvent.change(colorSelect, { target: { value: "v-red" } });
    expect(agree).toBeEnabled();
  });

  it("el reemplazo acordado lleva el color y su costo real por color", async () => {
    renderSheet();
    await pickReplacement();
    const colorSelect = screen.getByLabelText(/Color del reemplazo/i);
    fireEvent.change(colorSelect, { target: { value: "v-red" } });
    fireEvent.click(screen.getByRole("button", { name: /Acordar resolución/i }));

    await waitFor(() => expect(mocks.applyIncidentEvent).toHaveBeenCalled());
    const extra = mocks.applyIncidentEvent.mock.calls[0][3];
    expect(extra.replacement.productId).toBe("p-luna");
    expect(extra.replacement.variantId).toBe("v-red");
    expect(extra.replacement.variantColor).toBe("Rojo");
  });

  it("una pieza clásica sigue sin pedir color", async () => {
    renderSheet();
    const input = screen.getByRole("combobox", { name: "Pieza alternativa" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Anillo Clásico" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByLabelText(/Color del reemplazo/i)).toBeNull());
    expect(screen.getByRole("button", { name: /Acordar resolución/i })).toBeEnabled();
  });
});

// Misión UX #461 (bloqueo 2): el reemplazo de una combinación agotada se
// acordaba sin aviso y fallaba sólo al confirmar, sin salida.
describe("IncidentSheet reemplazo de talla/color agotado (#461)", () => {
  const NOW2 = "2026-11-12T10:00:00.000Z";
  const sizedOrder: Order = {
    ...order,
    items: [{ lineId: "l1", productId: "p-sol", productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6", quantity: 1, unitPrice: 350, subtotal: 350 }],
    incidents: [{
      id: "inc-s", productId: "p-sol", productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6",
      quantity: 1, reason: "Defectuosa", originalUnitPriceCents: 35000,
      events: [{ id: "ie-1", at: NOW2, by: "u1", kind: "opened" }],
    } as OrderIncident],
  };
  const sizedProducts: Product[] = [
    {
      id: "p-sol", storeId: "s1", name: "Anillo Sol", category: "other", isPublic: true, status: "published",
      // Tiered-only ficha (sin precio general): la propuesta no puede ser el nivel más barato.
      prices: { t_retail: 350, t_girly: 310, t_iconic: 280 }, cost: 100, createdAt: NOW2, updatedAt: NOW2,
      variants: [{
        id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, createdAt: NOW2, updatedAt: NOW2,
        sizes: [
          { id: "d6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 0, createdAt: NOW2, updatedAt: NOW2 },
          { id: "d7", size: "7", sku: "SOL-D-7", cost: 100, quantityOnHand: 2, createdAt: NOW2, updatedAt: NOW2 },
        ],
      }],
    } as Product,
  ];

  function renderSized() {
    mocks.state.products = sizedProducts;
    return render(
      <ToastProvider>
        <IncidentSheet order={sizedOrder} open onClose={() => {}} />
      </ToastProvider>
    );
  }
  async function pickSizedReplacement() {
    const input = screen.getByRole("combobox", { name: "Pieza alternativa" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Anillo Sol" } });
    await waitFor(() => expect(screen.getByText(/Existencia: 2 en 1 color/i)).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText(/Color del reemplazo/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Color del reemplazo/), { target: { value: "v_gold" } });
    await waitFor(() => expect(screen.getByLabelText(/Talla del reemplazo/i)).toBeTruthy());
  }

  it("elegir la talla agotada avisa al momento y ofrece pasar a «Esperar reposición» ahí mismo", async () => {
    renderSized();
    await pickSizedReplacement();
    fireEvent.change(screen.getByLabelText(/Talla del reemplazo/), { target: { value: "d6" } });
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toMatch(/talla 6 está agotada/);
    expect(notice.textContent).toMatch(/Esperar reposición/);
    fireEvent.click(screen.getByRole("button", { name: /Esperar reposición por la talla agotada/ }));
    await waitFor(() => expect(screen.getByText(/Fecha acordada/i)).toBeTruthy()); // la solución cambió sola
  });

  it("no se puede acordar el reemplazo de una talla agotada: el botón se deshabilita con la razón visible", async () => {
    renderSized();
    await pickSizedReplacement();
    fireEvent.change(screen.getByLabelText(/Talla del reemplazo/), { target: { value: "d6" } });
    const agree = screen.getByRole("button", { name: /Acordar resolución/i });
    expect(agree).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toMatch(/no hay piezas que entregar/);
    fireEvent.change(screen.getByLabelText(/Talla del reemplazo/), { target: { value: "d7" } });
    expect(agree).toBeEnabled(); // con piezas, sí
  });

  it("la misma pieza se propone a su precio histórico (equivalente = mismo dinero), no al nivel más barato", async () => {
    renderSized();
    await pickSizedReplacement();
    fireEvent.change(screen.getByLabelText(/Talla del reemplazo/), { target: { value: "d7" } });
    fireEvent.click(screen.getByRole("button", { name: /Acordar resolución/i }));
    await waitFor(() => expect(mocks.applyIncidentEvent).toHaveBeenCalled());
    const extra = mocks.applyIncidentEvent.mock.calls[0][3];
    expect(extra.replacement.unitPriceCents).toBe(35000); // lo que la clienta pagó, no $280 del nivel Iconic
  });

  it("un reemplazo equivalente ya acordado de talla agotada ofrece «Volver a acordar» (antes: sin salida)", async () => {
    mocks.state.products = sizedProducts;
    const agreed: Order = {
      ...sizedOrder,
      incidents: [{
        ...sizedOrder.incidents![0],
        resolution: { kind: "replacement_equivalent" },
        replacement: { productId: "p-sol", productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6", unitPriceCents: 35000, unitCostCents: 10000, chargeDifference: false },
        events: [
          { id: "ie-1", at: NOW2, by: "u1", kind: "opened" },
          { id: "ie-2", at: NOW2, by: "u1", kind: "resolution_agreed" },
        ],
      } as OrderIncident],
    };
    render(
      <ToastProvider>
        <IncidentSheet order={agreed} open onClose={() => {}} />
      </ToastProvider>
    );
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toMatch(/talla 6 del color Dorado está agotada/);
    fireEvent.click(screen.getByRole("button", { name: /Volver a acordar la solución/i }));
    await waitFor(() => expect(screen.getByLabelText(/Solución acordada con la clienta/i)).toBeTruthy());
  });

  it("el resumen de un reemplazo equivalente no dice «diferencia absorbida» (no hay diferencia)", async () => {
    mocks.state.products = sizedProducts;
    const agreed: Order = {
      ...sizedOrder,
      incidents: [{
        ...sizedOrder.incidents![0],
        resolution: { kind: "replacement_equivalent" },
        replacement: { productId: "p-sol", productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d7", variantSize: "7", unitPriceCents: 35000, unitCostCents: 10000, chargeDifference: false },
        events: [
          { id: "ie-1", at: NOW2, by: "u1", kind: "opened" },
          { id: "ie-2", at: NOW2, by: "u1", kind: "resolution_agreed" },
        ],
      } as OrderIncident],
    };
    render(
      <ToastProvider>
        <IncidentSheet order={agreed} open onClose={() => {}} />
      </ToastProvider>
    );
    const summary = screen.getByText(/Anillo Sol \(Dorado · 7\)/);
    expect(summary.textContent).toContain("$350.00");
    expect(summary.textContent).not.toContain("diferencia");
  });
});
