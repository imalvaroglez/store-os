// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { DeliverySheet } from "./DeliverySheet";
import { DeliveryWithBalanceError } from "../../app/firebase/firestoreData";
import type { Order } from "../../types";

// #333: the delivery sheet registers WHAT was handed (per piece, with its
// effective date). Full delivery completes the order; partial leaves it open;
// over-delivery is denied without losing the capture; the #165/#168 saldo
// gate demands explicit confirmation before completing.

const mocks = vi.hoisted(() => ({
  registerDelivery: vi.fn(),
  state: {
    products: [
      { id: "p1", storeId: "s1", name: "Anillo Luna" },
      { id: "p2", storeId: "s1", name: "Sol dorado", variants: [{ id: "v_dorado", color: "Dorado" }] },
    ],
    customers: [],
  },
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({ registerDelivery: mocks.registerDelivery, state: mocks.state }),
}));

const order: Order = {
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [
    { productId: "p1", productName: "Anillo Luna", quantity: 2, unitPrice: 100, subtotal: 200 },
    { productId: "p2", variantId: "v_dorado", productName: "Sol dorado", quantity: 1, unitPrice: 50, subtotal: 50 },
  ],
  deposit: 0,
  orderStatus: "asked",
  paymentStatus: "unpaid",
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
};

function renderSheet(o: Order = order) {
  return render(
    <ToastProvider>
      <DeliverySheet order={o} open onClose={() => {}} />
    </ToastProvider>
  );
}

beforeEach(() => {
  mocks.registerDelivery.mockReset();
});

describe("DeliverySheet (#333)", () => {
  it("muestra total/entregadas/pendientes con nombre y color por dimensión", () => {
    renderSheet();
    expect(screen.getByText("Piezas del pedido")).toBeTruthy();
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(2); // piezas y pendientes
    expect(screen.getByText("Anillo Luna")).toBeTruthy();
    expect(screen.getByText(/Sol dorado · Dorado/)).toBeTruthy();
    expect(screen.getAllByLabelText("Entregar")).toHaveLength(2);
  });

  it("entrega completa registra las piezas pendientes con su fecha y confirma al usuario", async () => {
    mocks.registerDelivery.mockResolvedValue({ ...order });
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(1));
    const [calledOrder, delivery] = mocks.registerDelivery.mock.calls[0];
    expect(calledOrder.id).toBe("o1");
    expect(delivery.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(delivery.lines).toEqual(
      expect.arrayContaining([
        { productId: "p1", quantity: 2 },
        { productId: "p2", variantId: "v_dorado", quantity: 1 },
      ])
    );
    expect(await screen.findByText("Entrega registrada. Pedido entregado por completo.")).toBeTruthy();
  });

  it("entrega parcial: solo las piezas escritas; el resto sigue pendiente", async () => {
    mocks.registerDelivery.mockResolvedValue({ ...order });
    renderSheet();
    const fields = screen.getAllByLabelText(/Entregar/);
    fireEvent.change(fields[0], { target: { value: "1" } }); // 1 de 2 del anillo
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(1));
    const lines = mocks.registerDelivery.mock.calls[0][1].lines;
    expect(lines).toEqual(
      expect.arrayContaining([
        { productId: "p1", quantity: 1 },
        { productId: "p2", variantId: "v_dorado", quantity: 1 }, // default: lo pendiente
      ])
    );
    expect(await screen.findByText("Entrega parcial registrada.")).toBeTruthy();
  });

  it("reintentar reutiliza el MISMO id de evento (nunca duplica)", async () => {
    mocks.registerDelivery.mockRejectedValueOnce(new Error("red"));
    mocks.registerDelivery.mockResolvedValue({ ...order });
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" })); // retry
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(2));
    expect(mocks.registerDelivery.mock.calls[0][1].id).toBe(mocks.registerDelivery.mock.calls[1][1].id);
  });

  it("entregar de más es rechazado sin perder la captura", async () => {
    renderSheet();
    const fields = screen.getAllByLabelText(/Entregar/);
    fireEvent.change(fields[0], { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    expect(await screen.findByText(/No puedes entregar más piezas de las que siguen pendientes./)).toBeTruthy();
    expect(mocks.registerDelivery).not.toHaveBeenCalled();
    expect((fields[0] as HTMLInputElement).value).toBe("9"); // la captura sigue ahí
  });

  it("la compuerta de saldo (#165/#168) exige confirmación explícita y registra la autorización", async () => {
    mocks.registerDelivery.mockRejectedValueOnce(new DeliveryWithBalanceError(15000));
    mocks.registerDelivery.mockResolvedValue({ ...order });
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    const dialog = await screen.findByRole("dialog", { name: "Entregar con saldo pendiente" });
    expect(dialog.textContent).toContain("$150.00");
    fireEvent.click(screen.getByRole("button", { name: "Entregar y registrar autorización" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(2));
    expect(mocks.registerDelivery.mock.calls[1][2]).toEqual({ confirmDeliveredWithBalance: true });
  });

  it("lista las entregas ya registradas con su fecha efectiva", () => {
    const partiallyDelivered: Order = {
      ...order,
      deliveries: [
        {
          id: "dev1",
          orderId: "o1",
          storeId: "s1",
          deliveredAt: "2026-11-28",
          recordedAt: "2026-12-01T10:00:00.000Z",
          by: "u1",
          lines: [{ productId: "p1", quantity: 1 }],
        },
      ],
    };
    renderSheet(partiallyDelivered);
    expect(screen.getByRole("list", { name: "Entregas registradas" })).toBeTruthy();
    expect(screen.getByText(/28 nov/)).toBeTruthy();
    expect(screen.getByText("Pendientes")).toBeTruthy();
  });
});
