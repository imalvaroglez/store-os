// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderCard } from "./OrderCard";
import type { Order } from "../../types";

vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ upsertOrder: vi.fn(), activeStore: { name: "Olivia" }, state: { customers: [{ id: "c1", storeId: "s1", name: "Sofía" }], products: [] } }) }));
const order: Order = { id: "o1", storeId: "s1", customerId: "c1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 1.25, subtotal: 1.25 }], deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", createdAt: "2026-01-01", updatedAt: "" };

describe("sharing a saved order", () => {
  it("copies the displayed text without opening the editor", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const edit = vi.fn();
    const rendered = render(<ToastProvider><OrderCard order={order} onEdit={edit} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    expect(edit).not.toHaveBeenCalled();
    const text = screen.getByLabelText("Detalle del pedido") as HTMLTextAreaElement;
    expect(text.value).toContain("Anillo");
    expect(text.value).toContain("Total: $1.25");
    fireEvent.click(screen.getByRole("button", { name: "Copiar detalle" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(text.value));
    rendered.unmount();
  });

  it("keeps selectable text when the clipboard is denied", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const rendered = render(<ToastProvider><OrderCard order={order} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar detalle" }));
    await waitFor(() => expect(screen.getByText(/Selecciona el texto/)).toBeInTheDocument());
    expect((screen.getByLabelText("Detalle del pedido") as HTMLTextAreaElement).value).toContain("Anillo");
    rendered.unmount();
  });
});
