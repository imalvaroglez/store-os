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
