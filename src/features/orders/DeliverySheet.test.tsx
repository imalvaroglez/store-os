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

  it("tras un éxito, la SIGUIENTE entrega usa un id NUEVO (nunca un no-op silencioso)", async () => {
    mocks.registerDelivery.mockResolvedValue({ ...order });
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(1));
    const firstId = mocks.registerDelivery.mock.calls[0][1].id;
    // Fer cierra, reabre y registra otra entrega (partial left the order open).
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(2));
    expect(mocks.registerDelivery.mock.calls[1][1].id).not.toBe(firstId);
  });

  it("una fecha futura o malformada es rechazada antes de registrar (P2 revisión)", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("Fecha de entrega"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    expect(await screen.findByText(/debe ser una fecha real de hoy o anterior/)).toBeTruthy();
    expect(mocks.registerDelivery).not.toHaveBeenCalled();
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

// #461 (dictamen QA 23-nov, crítico 2): la hoja de entrega fusionaba dos
// tallas del mismo color en una fila y registraba la entrega sin talla; al
// cancelar el remanente volvían piezas ya entregadas. Cada talla es su propia
// fila y cada línea entregada lleva SU talla.
describe("DeliverySheet — entrega por combinación color × talla (#461)", () => {
  const sizedLine = (sizeId: string, size: string, quantity: number, lineId: string) => ({
    lineId, productId: "p2", variantId: "v_dorado", variantColor: "Dorado", variantSizeId: sizeId, variantSize: size,
    productName: "Anillo Sol", quantity, unitPrice: 400, subtotal: 400 * quantity,
  });
  const sizedOrder = (items = [sizedLine("d6", "6", 2, "l1"), sizedLine("d5", "5", 1, "l2")]): Order =>
    ({ ...order, orderStatus: "ready", items }) as Order;

  beforeEach(() => {
    mocks.state.products = [
      mocks.state.products[0],
      {
        id: "p2", storeId: "s1", name: "Anillo Sol",
        variants: [{ id: "v_dorado", color: "Dorado", sizes: [{ id: "d6", size: "6" }, { id: "d5", size: "5" }] }],
      },
    ] as never;
  });

  it("dos tallas del mismo color son filas separadas y la entrega lleva SU talla en cada línea", async () => {
    mocks.registerDelivery.mockResolvedValue({});
    renderSheet(sizedOrder());
    expect(screen.getByText("Anillo Sol · Dorado · 6")).toBeTruthy();
    expect(screen.getByText("Anillo Sol · Dorado · 5")).toBeTruthy();
    expect(screen.getAllByLabelText("Entregar")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(1));
    const [, delivery] = mocks.registerDelivery.mock.calls[0];
    expect(delivery.lines).toEqual([
      { productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 2 },
      { productId: "p2", variantId: "v_dorado", variantSizeId: "d5", quantity: 1 },
    ]);
  });

  it("entregar 1 pieza de la talla 6 registra SOLO esa combinación; la talla 5 sigue pendiente", async () => {
    mocks.registerDelivery.mockResolvedValue({});
    renderSheet(sizedOrder());
    const inputs = screen.getAllByLabelText("Entregar");
    fireEvent.change(inputs[0], { target: { value: "1" } });
    fireEvent.change(inputs[1], { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(mocks.registerDelivery).toHaveBeenCalledTimes(1));
    const [, delivery] = mocks.registerDelivery.mock.calls[0];
    expect(delivery.lines).toEqual([{ productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 1 }]);
    expect(await screen.findByText("Entrega parcial registrada.")).toBeTruthy();
  });

  it("las entregas ya registradas nombran la talla (sin depender del catálogo vigente)", () => {
    const delivered = {
      ...sizedOrder([sizedLine("d6", "6", 1, "l1")]),
      deliveries: [{ id: "d1", orderId: "o1", storeId: "s1", deliveredAt: "2026-11-22", recordedAt: "2026-11-22T10:00:00.000Z", by: "fer", lines: [{ productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 1 }] }],
    } as Order;
    renderSheet(delivered);
    expect(screen.getByText("1 × Anillo Sol · Dorado · 6")).toBeTruthy();
  });

  it("una pieza vendida sin talla en un color que ya se vende por talla se entrega tal como se vendió, nombrándolo", () => {
    const legacy = {
      ...order,
      orderStatus: "ready",
      items: [{ lineId: "l9", productId: "p2", variantId: "v_dorado", variantColor: "Dorado", productName: "Anillo Sol", quantity: 1, unitPrice: 400, subtotal: 400 }],
    } as Order;
    renderSheet(legacy);
    expect(screen.getByText("Anillo Sol · Dorado (vendida sin talla)")).toBeTruthy();
  });
});
