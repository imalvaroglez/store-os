// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { IncidentSheet } from "./IncidentSheet";
import type { Order, OrderIncident, Product } from "../../types";

// #461 (dictamen QA 23-nov, crítico 4): la posventa identifica la pieza por
// color Y TALLA. La incidencia conserva la talla de su línea y un reemplazo en
// un color que se vende por talla exige la talla que se entrega — la
// transacción mueve esa combinación y falla cerrado sin ella.

const mocks = vi.hoisted(() => ({
  state: { products: [] as Product[] },
  activeStore: { id: "s1" },
  openIncident: vi.fn(),
  applyIncidentEvent: vi.fn(),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => mocks }));

const NOW = "2026-11-23T10:00:00.000Z";

const soldLine = {
  lineId: "l6", productId: "p-sol", productName: "Anillo Sol",
  variantId: "v_gold", variantColor: "Dorado", variantSku: "SOL-D",
  variantSizeId: "d6", variantSize: "6", variantSizeSku: "SOL-D-6",
  quantity: 1, unitPrice: 400, subtotal: 400,
};

const orderWith = (incidents?: OrderIncident[]): Order => ({
  id: "o1", storeId: "s1", customerId: "c1",
  items: [soldLine],
  deposit: 0, orderStatus: "delivered", paymentStatus: "paid", paymentsReceivedCents: 40000,
  createdAt: NOW, updatedAt: NOW,
  ...(incidents ? { incidents } : {}),
});

const products: Product[] = [
  {
    id: "p-sol", storeId: "s1", name: "Anillo Sol", sku: "SOL", category: "other",
    isPublic: true, status: "published", price: 400, cost: 100,
    variants: [
      {
        id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, createdAt: NOW, updatedAt: NOW,
        sizes: [
          { id: "d6", size: "6", sku: "SOL-D-6", cost: 180, quantityOnHand: 1, createdAt: NOW, updatedAt: NOW },
          { id: "d5", size: "5", sku: "SOL-D-5", cost: 160, quantityOnHand: 2, createdAt: NOW, updatedAt: NOW },
        ],
      },
      { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "SOL-P", cost: 90, quantityOnHand: 4, createdAt: NOW, updatedAt: NOW },
    ],
    createdAt: NOW, updatedAt: NOW,
  } as Product,
];

const openedIncident = (): OrderIncident => ({
  id: "inc-1", lineId: "l6", productId: "p-sol", productName: "Anillo Sol",
  variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6",
  quantity: 1, reason: "Piedra fallada", originalUnitPriceCents: 40000,
  events: [{ id: "iev-1", at: NOW, by: "u1", kind: "opened" }],
} as OrderIncident);

function renderSheet(order: Order) {
  mocks.state.products = products;
  return render(
    <ToastProvider>
      <IncidentSheet order={order} open onClose={() => {}} />
    </ToastProvider>
  );
}

async function pickReplacement(name: string) {
  const input = screen.getByRole("combobox", { name: "Pieza alternativa" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.getByLabelText(/Color del reemplazo/i)).toBeTruthy());
}

describe("IncidentSheet por talla (#461 — dictamen QA)", () => {
  beforeEach(() => {
    mocks.openIncident.mockReset().mockResolvedValue(undefined);
    mocks.applyIncidentEvent.mockReset().mockResolvedValue(undefined);
  });

  it("registrar problema conserva la talla de la línea y la nombra en el selector", async () => {
    renderSheet(orderWith());
    const piece = screen.getByLabelText(/Pieza/) as HTMLSelectElement;
    expect([...piece.options].map((option) => option.textContent)).toContain("1 × Anillo Sol · Dorado · 6");
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Piedra fallada" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar problema" }));
    await waitFor(() => expect(mocks.openIncident).toHaveBeenCalledTimes(1));
    const incident = mocks.openIncident.mock.calls[0][1] as OrderIncident;
    expect(incident).toMatchObject({ variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6", variantSizeSku: "SOL-D-6" });
  });

  it("la incidencia abierta nombra su color y su talla", () => {
    renderSheet(orderWith([openedIncident()]));
    expect(screen.getByRole("heading", { name: "1 × Anillo Sol · Dorado · 6" })).toBeTruthy();
  });

  it("un reemplazo en un color que se vende por talla exige la talla; sin ella no se acuerda nada", async () => {
    renderSheet(orderWith([openedIncident()]));
    await pickReplacement("Anillo Sol");
    fireEvent.change(screen.getByLabelText(/Color del reemplazo/i), { target: { value: "v_gold" } });
    const talla = await screen.findByLabelText(/Talla del reemplazo/i);
    // La talla de la incidencia (6) queda 1; la 5 queda 2 — con su estante propio.
    expect([...(talla as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Elige la talla…", "6 (queda 1)", "5 (quedan 2)"]);
    // Misma pieza y color: la talla de la incidencia se propone y Fer la revisa.
    expect((talla as HTMLSelectElement).value).toBe("d6");
    fireEvent.change(talla, { target: { value: "" } });
    const agree = screen.getByRole("button", { name: /Acordar resolución/i });
    expect(agree).toBeDisabled();
    fireEvent.change(talla, { target: { value: "d5" } });
    expect(agree).toBeEnabled();
    fireEvent.click(agree);
    await waitFor(() => expect(mocks.applyIncidentEvent).toHaveBeenCalledTimes(1));
    const extra = mocks.applyIncidentEvent.mock.calls[0][3];
    expect(extra.replacement).toMatchObject({
      productId: "p-sol", variantId: "v_gold", variantSizeId: "d5", variantSize: "5", variantSizeSku: "SOL-D-5",
      unitCostCents: 16000, // el costo de ESA combinación, no el del color
    });
  });

  it("el color sin tallas no pide talla y el de tallas muestra su existencia derivada", async () => {
    renderSheet(orderWith([openedIncident()]));
    await pickReplacement("Anillo Sol");
    const color = screen.getByLabelText(/Color del reemplazo/i);
    expect([...(color as HTMLSelectElement).options].map((option) => option.textContent)).toContain("Dorado — quedan 3");
    fireEvent.change(color, { target: { value: "v_silver" } });
    expect(screen.queryByLabelText(/Talla del reemplazo/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Acordar resolución/i })).toBeEnabled();
  });

  it("la solución acordada nombra la talla entregada", () => {
    const agreed = openedIncident();
    agreed.events = [...agreed.events, { id: "iev-2", at: NOW, by: "u1", kind: "resolution_agreed" }];
    agreed.resolution = { kind: "replacement_equivalent" };
    agreed.replacement = { productId: "p-sol", productName: "Anillo Sol", unitPriceCents: 40000, unitCostCents: 16000, chargeDifference: false, variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d5", variantSize: "5" };
    renderSheet(orderWith([agreed]));
    expect(screen.getByText(/Anillo Sol \(Dorado · 5\)/)).toBeTruthy();
  });
});
